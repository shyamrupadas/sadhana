import { Button } from '@/shared/components/ui/button'
import { Link } from 'react-router'
import { ROUTES } from '@/shared/model/routes'
import { AuthLayout } from './ui/auth-layout'
import { RegisterForm } from './ui/register-form'

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
