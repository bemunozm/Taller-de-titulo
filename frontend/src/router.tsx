import { BrowserRouter, Routes, Route} from 'react-router-dom'
import DashboardView from '@/views/DashboardView'
import RegisterView from '@/views/auth/RegisterView'
import AppLayout from '@/layouts/AppLayout'
import { AuthLayout } from '@/layouts/AuthLayout'

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
                    <Route path='/register' element={<RegisterView/>} /> 
                </Route>
            </Routes>
        </BrowserRouter>
    )
}