// Same call, but the class is imported through the tsconfig "paths" alias.
import { ToastService } from '@lib/toast';

export class AliasConsumer {
  constructor(private toast: ToastService) {}

  run(): void {
    this.toast.openSuccessUniqueXyz('from alias consumer');
  }
}
