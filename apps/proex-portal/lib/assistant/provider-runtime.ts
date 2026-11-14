/** O Worker só usa os endpoints fixos. O build Node substitui este módulo. */
export const pinnedProviderRequest: ((url: URL, init: RequestInit) => Promise<Response>) | null = null;
