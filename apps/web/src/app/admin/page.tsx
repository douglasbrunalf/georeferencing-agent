'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { adminCreateUser } from '@/lib/auth';
import { ArrowLeft, CheckCircle2, Loader2, Mail, UserPlus } from 'lucide-react';

export default function AdminPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreatedEmail(null);
    try {
      await adminCreateUser(email);
      setCreatedEmail(email);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Volver
        </Link>

        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-md bg-brand text-brand-foreground">
                <UserPlus className="size-4" />
              </span>
              <CardTitle>Nuevo usuario</CardTitle>
            </div>
            <CardDescription>
              Creá una cuenta para alguien más del equipo. Puede ser de cualquier dominio — le llega una
              contraseña temporal por correo y la cambia por una propia en su primer ingreso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Correo del nuevo usuario</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="nombre@cnid.co"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {createdEmail && (
                <p className="flex items-center gap-1.5 text-sm text-brand">
                  <CheckCircle2 className="size-4" /> Cuenta creada. Le enviamos una contraseña temporal a{' '}
                  {createdEmail}.
                </p>
              )}
              <Button
                type="submit"
                disabled={submitting}
                className="bg-brand text-brand-foreground hover:bg-brand-hover"
              >
                {submitting && <Loader2 className="animate-spin" />}
                Crear cuenta
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
