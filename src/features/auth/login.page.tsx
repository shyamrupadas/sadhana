import { Button } from '@/shared/components/ui/button'
import { ROUTES } from '@/shared/model/routes'
import { Link } from 'react-router'
import { AuthLayout } from './auth-layout'
import { LoginForm } from './login-form'

const LoginPage = () => {
  return (
    <AuthLayout
      title="Вход"
      description="Введите email и пароль"
      form={<LoginForm />}
      footer={
        <p className="text-sm text-primary">
          Нет аккаунта?{' '}
          <Button asChild variant="link" size="sm">
            <Link to={ROUTES.REGISTER}>Зарегистрироваться</Link>
          </Button>
        </p>
      }
    />
  )
}

export const Component = LoginPage
