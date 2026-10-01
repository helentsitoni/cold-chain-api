import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Cold chain flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let nurseToken: string;
  let labToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.alert.deleteMany();
    await prisma.custodyEvent.deleteMany();
    await prisma.temperatureReading.deleteMany();
    await prisma.sample.deleteMany();
    await prisma.user.deleteMany();

    const server = app.getHttpServer();

    await request(server)
      .post('/auth/register')
      .send({ email: 'nurse@e2e.com', password: 'secret123', role: 'FIELD_NURSE' })
      .expect(201);
    await request(server)
      .post('/auth/register')
      .send({ email: 'lab@e2e.com', password: 'secret123', role: 'LAB_ANALYST' })
      .expect(201);

    nurseToken = (
      await request(server)
        .post('/auth/login')
        .send({ email: 'nurse@e2e.com', password: 'secret123' })
        .expect(200)
    ).body.access_token;
    labToken = (
      await request(server)
        .post('/auth/login')
        .send({ email: 'lab@e2e.com', password: 'secret123' })
        .expect(200)
    ).body.access_token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects requests without a token', () => {
    return request(app.getHttpServer()).get('/samples').expect(401);
  });

  it('rejects a wrong password', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nurse@e2e.com', password: 'wrongpass' })
      .expect(401);
  });

  it('runs the full cold chain and locks a sample above 8 °C', async () => {
    const server = app.getHttpServer();

    const created = await request(server)
      .post('/samples')
      .set(auth(nurseToken))
      .send({ code: 'E2E-001', minTemp: 2, maxTemp: 8 })
      .expect(201);
    const id = created.body.id;
    expect(created.body.status).toBe('COLLECTED');

    await request(server)
      .post('/samples')
      .set(auth(labToken))
      .send({ code: 'E2E-002', minTemp: 2, maxTemp: 8 })
      .expect(403);

    await request(server)
      .patch(`/samples/${id}/status`)
      .set(auth(nurseToken))
      .send({ toStatus: 'IN_TRANSIT' })
      .expect(200);

    const ok = await request(server)
      .post(`/samples/${id}/readings`)
      .set(auth(nurseToken))
      .send({ value: 6.4 })
      .expect(201);
    expect(ok.body.status).toBe('IN_TRANSIT');

    const bad = await request(server)
      .post(`/samples/${id}/readings`)
      .set(auth(nurseToken))
      .send({ value: 9.1 })
      .expect(201);
    expect(bad.body.status).toBe('COMPROMISED');

    await request(server)
      .patch(`/samples/${id}/status`)
      .set(auth(labToken))
      .send({ toStatus: 'LAB_RECEIVED' })
      .expect(409);

    const detail = await request(server)
      .get(`/samples/${id}`)
      .set(auth(labToken))
      .expect(200);
    expect(
      detail.body.events.map((e: { toStatus: string }) => e.toStatus),
    ).toEqual(['COLLECTED', 'IN_TRANSIT', 'COMPROMISED']);
    expect(detail.body.readings).toHaveLength(2);
  });
});