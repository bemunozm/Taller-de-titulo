import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Router from './router'
import './index.css'
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'

const queryClient = new QueryClient()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  </StrictMode>,
)
// If you want to start measuring performance in your app, pass a function