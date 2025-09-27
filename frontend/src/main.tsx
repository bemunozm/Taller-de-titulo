import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Router from './router'
import './index.css'
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css';

const queryClient = new QueryClient()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router />
      <ToastContainer position="bottom-right" autoClose={5000} hideProgressBar={false} closeOnClick draggable pauseOnHover theme="light" />
    </QueryClientProvider>
  </StrictMode>,
)
// If you want to start measuring performance in your app, pass a function