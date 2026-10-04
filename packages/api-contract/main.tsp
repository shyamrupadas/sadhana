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

@route("/habits")
@useAuth(BearerAuth)
interface Habits {
  /** List the authenticated user's habits in creation order. */
  @get getHabits(): HabitsResponse | UnauthorizedResponse | InternalErrorResponse;
}
