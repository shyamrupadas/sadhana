import "@typespec/http";

using TypeSpec.Http;

@service(#{ title: "Sadhana API" })
namespace Sadhana;

model HabitDefinition {
  key: string;
  label: string;
  createdAt: utcDateTime;
}

model ApiError {
  message: string;
  code: string;
}

model HabitsResponse {
  @statusCode statusCode: 200;
  @body habits: HabitDefinition[];
}

model UnauthorizedResponse {
  @statusCode statusCode: 401;
  @body error: ApiError;
}

model InternalErrorResponse {
  @statusCode statusCode: 500;
  @body error: ApiError;
}

model User {
  id: string;
  @format("email")
  email: string;
}

model RegisterRequest {
  @format("email")
  email: string;
  @minLength(6)
  password: string;
}

model LoginRequest {
  @format("email")
  email: string;
  password: string;
}

model AuthResponse {
  accessToken: string;
  user: User;
}

model RegisteredResponse {
  @statusCode statusCode: 201;
  @header("Set-Cookie") setCookie: string;
  @body body: AuthResponse;
}

model AuthenticatedResponse {
  @statusCode statusCode: 200;
  @header("Set-Cookie") setCookie: string;
  @body body: AuthResponse;
}

model BadRequestResponse {
  @statusCode statusCode: 400;
  @body error: ApiError;
}

@route("/auth")
interface Auth {
  @post @route("/register") register(@body body: RegisterRequest): RegisteredResponse | BadRequestResponse | InternalErrorResponse;
  @post @route("/login") login(@body body: LoginRequest): AuthenticatedResponse | UnauthorizedResponse | InternalErrorResponse;
  @post @route("/refresh") refresh(@cookie("refreshToken") refreshToken?: string): AuthenticatedResponse | UnauthorizedResponse | InternalErrorResponse;
}

@route("/habits")
@useAuth(BearerAuth)
interface Habits {
  /** List the authenticated user's habits in creation order. */
  @get getHabits(): HabitsResponse | UnauthorizedResponse | InternalErrorResponse;
}
