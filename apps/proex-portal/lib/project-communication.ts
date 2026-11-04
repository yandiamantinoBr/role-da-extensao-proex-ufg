export const COMMUNICATION_CHANNELS = {
  canva: 'Arte no Canva',
  site: 'Publicação no site',
  instagram: 'Publicação no Instagram',
} as const;

export const COMMUNICATION_NOTE_LIMIT = 600;

export function communicationLabel(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(COMMUNICATION_CHANNELS, value)
    ? COMMUNICATION_CHANNELS[value as keyof typeof COMMUNICATION_CHANNELS]
    : null;
}
