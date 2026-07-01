const OPENBD_ENDPOINT = "https://api.openbd.jp/v1/get";

export type OpenBdBook = {
  summary?: {
    isbn?: string;
    title?: string;
    author?: string;
    publisher?: string;
    series?: string;
    pubdate?: string;
    cover?: string;
  };
  [key: string]: unknown;
};

export async function fetchOpenBdBookByIsbn(
  isbn: string,
): Promise<OpenBdBook | undefined> {
  const url = new URL(OPENBD_ENDPOINT);
  url.searchParams.set("isbn", isbn);

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `openBD API failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as Array<OpenBdBook | null>;
  return data[0] ?? undefined;
}
