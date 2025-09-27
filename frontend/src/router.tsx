import { BrowserRouter, Routes, Route} from 'react-router-dom'
import DashboardView from '@/views/DashboardView'
import RegisterView from '@/views/auth/RegisterView'
import LoginView from '@/views/auth/LoginView'
import ForgotPasswordView from '@/views/auth/ForgotPasswordView'
import ConfirmAccountView from '@/views/auth/ConfirmAccountView'
import NewPasswordView from '@/views/auth/NewPasswordView'
import AppLayout from '@/layouts/AppLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import RequestCodeView from './views/auth/RequestCodeView'

export default function Router(){

    return (
        <BrowserRouter>
            <Routes>
                <Route element={<AppLayout/>}> {/* Se envuelven todas las rutas anidadas en un layout*/}
                
                   {/* 
                        -Se definen las rutas de la aplicación que comparten el layout
                        -En este caso, la ruta raíz renderiza el DashboardView
                        -index = define la ruta raíz
                        -element = componente a renderizar
                        -path = ruta de la aplicación
                    */}
                    <Route path='/' element={<DashboardView/>} index/>
                </Route>

                {/* Rutas de autenticación sin layout principal */}
                <Route element={<AuthLayout/>}> {/* Se envuelven todas las rutas anidadas en un layout*/}
                    <Route path='/auth/register' element={<RegisterView/>} /> 
                    <Route path='/auth/login' element={<LoginView/>} />
                    <Route path='/auth/forgot-password' element={<ForgotPasswordView/>} />
                    <Route path='/auth/confirm-account' element={<ConfirmAccountView/>} />
                    <Route path='/auth/request-code' element={<RequestCodeView/>} />
                    <Route path='/auth/new-password' element={<NewPasswordView/>} />
                </Route>
            </Routes>
        </BrowserRouter>
    )
}