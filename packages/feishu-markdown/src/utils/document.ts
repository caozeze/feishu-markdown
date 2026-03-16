import { FeishuDataError } from '@/errors';

export function normalizeDocumentId(documentIdOrUrl: string): string {
  const value = documentIdOrUrl.trim();

  if (!value) {
    throw new FeishuDataError('Document ID or docx URL is required');
  }

  if (/^[A-Za-z0-9]+$/.test(value)) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FeishuDataError(
      'Invalid document locator. Expected a document ID or docx URL.'
    );
  }

  const match = /^\/(docx|wiki)\/([A-Za-z0-9]+)/.exec(url.pathname);
  const documentType = match?.[1];
  const documentId = match?.[2];

  if (documentType === 'wiki') {
    throw new FeishuDataError(
      'Wiki URLs are not supported yet. Please provide a docx URL or document ID.'
    );
  }

  if (!documentId) {
    throw new FeishuDataError(
      'Invalid document locator. Expected a document ID or docx URL.'
    );
  }

  return documentId;
}
