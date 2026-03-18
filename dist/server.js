import cors from '@fastify/cors';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { ApiError } from './lib/http.js';
import { apiRoutes } from './routes/api.js';
const app = Fastify({
    logger: true,
});
async function bootstrap() {
    await app.register(cors, {
        origin: env.corsOrigin === '*'
            ? true
            : env.corsOrigin.split(',').map((origin) => origin.trim()),
    });
    app.setErrorHandler((error, _, reply) => {
        if (error instanceof ApiError) {
            return reply.status(error.statusCode).send({
                success: false,
                error: error.message,
            });
        }
        app.log.error(error);
        return reply.status(500).send({
            success: false,
            error: 'Error interno del servidor.',
        });
    });
    app.get('/', async () => ({
        success: true,
        data: {
            name: 'Anime API',
            provider: env.provider,
        },
    }));
    await app.register(apiRoutes, { prefix: '/api' });
    await app.listen({
        host: env.host,
        port: env.port,
    });
}
bootstrap().catch((error) => {
    app.log.error(error);
    process.exit(1);
});
