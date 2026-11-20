import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { dbStore } from './server/db/store.js';
import { setupWebSocketServer } from './server/ws/socketServer.js';
import { createVoiceLiveWss } from './server/ws/voiceLiveServer.js';
import { authRouter } from './server/routes/authRoutes.js';
import { adminRouter } from './server/routes/adminRoutes.js';
import { managerRouter } from './server/routes/managerRoutes.js';
import { ashaRouter } from './server/routes/ashaRoutes.js';
import { doctorRouter } from './server/routes/doctorRoutes.js';
import { patientRouter } from './server/routes/patientRoutes.js';
import { sharedRouter } from './server/routes/sharedRoutes.js';
import { voiceRouter } from './server/routes/voiceRoutes.js';

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(backendDir, '..');
dotenv.config({
  path: [
    path.join(backendDir, '.env.local'),
    path.join(backendDir, '.env'),
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env'),
  ],
});

const PORT = Number(process.env.PORT) || 3001;

async function bootstrap() {
  await dbStore.initMongoIfConfigured();

  const app = express();
  app.set('trust proxy', 1);
  const httpServer = http.createServer(app);

  // Security headers (allow inline scripts/styles in Vite dev & Leaflet tile hosts)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  const rateLimitKeyGenerator = (req: express.Request): string => {
    const forwardedHeader = req.headers.forwarded;
    let clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';

    if (typeof forwardedHeader === 'string') {
      const match = forwardedHeader.match(/for=(?:"([^"]+)"|([^;,\s]+))/i);
      const rawFor = (match?.[1] || match?.[2] || '').trim();
      if (rawFor) {
        let candidate = rawFor;
        if (candidate.startsWith('[')) {
          const closingIdx = candidate.indexOf(']');
          if (closingIdx > 1) {
            candidate = candidate.slice(1, closingIdx);
          }
        } else if (candidate.includes('.') && candidate.includes(':')) {
          candidate = candidate.split(':')[0];
        }
        if (net.isIP(candidate) !== 0) {
          clientIp = candidate;
        }
      }
    }

    return ipKeyGenerator(clientIp);
  };

  // Rate limiting for auth & AI endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKeyGenerator,
    message: { error: 'Too many authentication attempts. Please wait a few minutes.' },
  });

  const aiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKeyGenerator,
    message: { error: 'Too many screening submissions. Please wait before submitting again.' },
  });

  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/manager', managerRouter);
  app.use('/api/asha', ashaRouter);
  app.use('/api/doctor', doctorRouter);
  app.use('/api/patient/screenings', aiLimiter);
  app.use('/api/patient', patientRouter);
  app.use('/api/voice', aiLimiter, voiceRouter);
  app.use('/api', sharedRouter);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      mongoConnected: dbStore.isMongoActive(),
      timestamp: new Date().toISOString(),
    });
  });

  const frontendDistDir = path.join(projectRoot, 'frontend', 'dist');
  if (fs.existsSync(frontendDistDir)) {
    app.use(express.static(frontendDistDir));
    app.get('*', (req, res, next) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(frontendDistDir, 'index.html'));
    });
  }

  // Error handler for Multer & JSON errors
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('Server error:', err.message);
      res.status(400).json({ error: err.message || 'Bad request' });
    }
  );

  const mainWss = setupWebSocketServer();
  const voiceWss = createVoiceLiveWss();

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/ws') {
      mainWss.handleUpgrade(request, socket, head, (ws) => {
        mainWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/voice') {
      voiceWss.handleUpgrade(request, socket, head, (ws) => {
        voiceWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Aarogya Drishti API listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start Aarogya Drishti server:', err);
  process.exit(1);
});
