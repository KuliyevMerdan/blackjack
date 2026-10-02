// FIXTURE — must be rejected by `packages-no-server-libs`: no package imports the HTTP server.
import Fastify from 'fastify';

export const leak = Fastify;
