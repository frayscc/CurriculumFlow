export interface FileService {
  saveFile(blob: Blob, filename: string): void;
  saveZip(blob: Blob, filename: string): void;
}

export class BrowserFileService implements FileService {
  saveFile(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  saveZip(blob: Blob, filename: string): void { this.saveFile(blob, filename); }
}

export const browserFileService = new BrowserFileService();
