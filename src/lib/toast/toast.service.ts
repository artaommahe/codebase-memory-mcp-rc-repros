export class ToastService {
  openSuccessUniqueXyz(message: string): void {
    console.log(message);
  }
}

// CONTROL for Case A: the *identical* call, but in the same file as the callee.
// This one resolves — via the type-aware `lsp_ts_method` strategy at confidence 0.95.
export function sameFileControl(): void {
  const t = new ToastService();
  t.openSuccessUniqueXyz('same-file control');
}
