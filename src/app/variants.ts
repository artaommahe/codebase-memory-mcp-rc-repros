import { ToastService } from '../lib/toast/toast.service';

// Five distinct shapes, all calling ToastService.openSuccessUniqueXyz across a
// file boundary via a plain relative import.

// V1: instantiate and call in one expression
export function v1(): void {
  new ToastService().openSuccessUniqueXyz('v1');
}

// V2: local variable, inferred type
export function v2(): void {
  const t = new ToastService();
  t.openSuccessUniqueXyz('v2');
}

// V3: local variable, explicit type annotation
export function v3(): void {
  const t: ToastService = new ToastService();
  t.openSuccessUniqueXyz('v3');
}

// V4: explicitly typed function parameter
export function v4(t: ToastService): void {
  t.openSuccessUniqueXyz('v4');
}

// V5: typed class field assigned in the constructor body
export class V5 {
  private t: ToastService;
  constructor() {
    this.t = new ToastService();
  }
  run(): void {
    this.t.openSuccessUniqueXyz('v5');
  }
}
