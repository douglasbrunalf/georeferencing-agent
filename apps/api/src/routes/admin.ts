import type { FastifyInstance } from 'fastify';
import { AdminCreateUserCommand, UsernameExistsException } from '@aws-sdk/client-cognito-identity-provider';
import { cognito, env } from '../lib/aws-clients.js';
import { requireAuth, requireCnidCoAdmin } from '../lib/auth.js';

// Basic RFC-ish email shape check. The caller is already gated to @cnid.co
// admins by requireCnidCoAdmin; the account being created may belong to any
// domain, so we only validate that it's a well-formed email here.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);
  app.addHook('onRequest', requireCnidCoAdmin);

  app.post('/api/admin/users', async (request, reply) => {
    const body = request.body as { email?: string } | undefined;
    const email = body?.email?.trim().toLowerCase();

    if (!email || !EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'Ingresá un correo válido.' });
    }

    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: env.userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
          // No SUPPRESS: Cognito emails the new user a temporary password
          // directly. They set their own permanent one on first login — the
          // admin creating the account never sees or chooses it.
        })
      );
      return reply.code(201).send({ email });
    } catch (err) {
      if (err instanceof UsernameExistsException) {
        return reply.code(409).send({ error: 'Ya existe una cuenta con ese correo.' });
      }
      request.log.error({ err }, 'admin create user failed');
      return reply.code(500).send({ error: 'No se pudo crear el usuario.' });
    }
  });
}
