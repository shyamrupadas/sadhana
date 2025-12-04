import { Button } from '@/shared/components/ui/button'
import { AuthLayout } from './auth-layout'
import { Link } from 'react-router'
import { ROUTES } from '@/shared/model/routes'
import { RegisterForm } from './register-form'

const RegisterPage = () => {
  return (
    <AuthLayout
      title="Регистрация"
      description="Введите email и пароль для регистрации"
      form={<RegisterForm />}
      footer={
        <p className="text-sm text-primary">
          Уже еть аккаунт?{' '}
          <Button asChild variant="link" size="sm">
            <Link to={ROUTES.LOGIN}>Войти</Link>
          </Button>
        </p>
      }
    />
  )
}

export const Component = RegisterPage
