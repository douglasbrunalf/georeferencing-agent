import type { AddressRecord } from '@/lib/api';
import { STATUS_LABELS } from '@/lib/labels';

const CSV_COLUMNS = [
  'id',
  'direccion_original',
  'precision_antes',
  'nivel_detalle_antes',
  'direccion_optimizada',
  'precision_despues',
  'nivel_detalle_despues',
  'estado',
] as const;

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toRow(addr: AddressRecord): Record<(typeof CSV_COLUMNS)[number], unknown> {
  return {
    id: addr.externalId ?? addr.addressId,
    direccion_original: addr.originalText,
    precision_antes: addr.precisionBefore ?? '',
    nivel_detalle_antes: addr.detailLevelBefore ?? '',
    direccion_optimizada: addr.normalizedText ?? '',
    precision_despues: addr.precisionAfter ?? '',
    nivel_detalle_despues: addr.detailLevelAfter ?? '',
    estado: STATUS_LABELS[addr.status] ?? addr.status,
  };
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadAddressesAsCsv(addresses: AddressRecord[], jobId: string) {
  const rows = addresses.map(toRow);
  const lines = [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => CSV_COLUMNS.map((col) => csvCell(row[col])).join(',')),
  ];
  downloadBlob(`﻿${lines.join('\n')}`, `direcciones-${jobId}.csv`, 'text/csv;charset=utf-8');
}

export function downloadAddressesAsJson(addresses: AddressRecord[], jobId: string) {
  const rows = addresses.map(toRow);
  downloadBlob(JSON.stringify(rows, null, 2), `direcciones-${jobId}.json`, 'application/json');
}
