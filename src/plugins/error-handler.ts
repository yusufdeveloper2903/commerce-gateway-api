import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError, type ProblemDetails } from '../lib/errors.js';

const PROBLEM_BASE = 'https://commerce-gateway.dev/problems';

function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  problem: ProblemDetails,
): FastifyReply {
  return reply
    .status(problem.status)
    .type('application/problem+json')
    .send(JSON.stringify({ ...problem, instance: request.url, requestId: request.id }));
}

/**
 * Converts every error into an RFC 7807 problem document. Internal details of
 * 5xx errors are logged but never sent to the client.
 */
export const errorHandlerPlugin = fp(
  async (app) => {
    app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
      if (error instanceof AppError) {
        const level = error.statusCode >= 500 ? 'warn' : 'info';
        request.log[level]({ err: error }, error.message);
        reply.headers(error.headers);
        return sendProblem(reply, request, {
          type: error.type,
          title: error.title,
          status: error.statusCode,
          detail: error.message,
        });
      }

      if (error.validation) {
        return sendProblem(reply, request, {
          type: `${PROBLEM_BASE}/validation`,
          title: 'Request validation failed',
          status: 400,
          detail: error.message,
          errors: error.validation.map((v) => {
            const path = (v.params as { issue?: { path?: unknown[] } } | undefined)?.issue?.path;
            return {
              path:
                Array.isArray(path) && path.length
                  ? path.join('.')
                  : v.instancePath.replace(/^\//, '').replace(/\//g, '.'),
              message: v.message ?? 'invalid',
            };
          }),
        });
      }

      const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
      if (status >= 500) {
        request.log.error({ err: error }, 'unhandled error');
        return sendProblem(reply, request, {
          type: `${PROBLEM_BASE}/internal`,
          title: 'Internal server error',
          status,
          detail: 'An unexpected error occurred',
        });
      }
      return sendProblem(reply, request, {
        type: status === 429 ? `${PROBLEM_BASE}/rate-limited` : 'about:blank',
        title: STATUS_CODES[status] ?? 'Error',
        status,
        detail: error.message,
      });
    });

    app.setNotFoundHandler((request, reply) =>
      sendProblem(reply, request, {
        type: `${PROBLEM_BASE}/not-found`,
        title: 'Resource not found',
        status: 404,
        detail: `Route ${request.method} ${request.url} not found`,
      }),
    );
  },
  { name: 'error-handler' },
);
