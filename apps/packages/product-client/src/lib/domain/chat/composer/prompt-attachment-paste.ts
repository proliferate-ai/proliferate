export function handlePromptAttachmentPaste(args: {
  defaultPrevented: boolean;
  canAcceptAttachments: boolean;
  fileCount: number;
  plainText: string;
  addFiles: () => void;
  addTextPaste: (text: string) => boolean;
}): boolean {
  if (args.defaultPrevented || !args.canAcceptAttachments) {
    return false;
  }
  if (args.fileCount > 0) {
    args.addFiles();
    return true;
  }
  return !!args.plainText && args.addTextPaste(args.plainText);
}
