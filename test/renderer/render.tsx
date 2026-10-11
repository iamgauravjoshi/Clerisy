import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ConfirmProvider, ToastProvider } from '../../src/renderer/src/components/ui'

/** Renders a page with the providers App puts around it, so confirmations and toasts work. */
export function renderWithProviders(ui: ReactElement) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </ToastProvider>
  )
}
