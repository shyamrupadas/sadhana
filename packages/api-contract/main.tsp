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

model HabitInput {
  label: string;
}

model CreatedHabitResponse {
  @statusCode statusCode: 201;
  @body habit: HabitDefinition;
}

model UpdatedHabitResponse {
  @statusCode statusCode: 200;
  @body habit: HabitDefinition;
}

model DeletedHabitResponse {
  @statusCode statusCode: 204;
}

model NotFoundResponse {
  @statusCode statusCode: 404;
  @body error: ApiError;
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

@pattern("^\\d{4}-\\d{2}-\\d{2}$")
scalar CalendarDate extends string;

model SleepData {
  @pattern("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$") bedtime: string | null;
  @pattern("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$") wakeTime: string | null;
  @minValue(0) napDuration: int32 | null;
  /** Computed from the previous day's bedtime, this day's wake time, and nap duration. Null when either time is absent. */
  @minValue(0) duration: int32 | null;
}

model SleepDataInput {
  @pattern("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$") bedtime?: string | null;
  @pattern("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$") wakeTime?: string | null;
  /** Zero is stored as null. */
  @minValue(0) napDuration: int32 | null;
}

model HabitCheck {
  key: string;
  value: boolean;
}

model DailyHabitMarkInput {
  value: boolean;
}

model DailyEntry {
  id: CalendarDate;
  date: CalendarDate;
  sleep: SleepData;
  habits: HabitCheck[];
}

model SleepRecordsResponse {
  @statusCode statusCode: 200;
  @body entries: DailyEntry[];
}

model DailyEntryResponse {
  @statusCode statusCode: 200;
  @body entry: DailyEntry;
}

model CheckYesterdayData {
  hasData: boolean;
}

model CheckYesterdayResponse {
  @statusCode statusCode: 200;
  @body body: CheckYesterdayData;
}

model SleepStatsPeriod {
  @pattern("^\\d{2}:\\d{2}$") bedtime: string | null;
  @pattern("^\\d{2}:\\d{2}$") wakeTime: string | null;
  @pattern("^\\d+:\\d{2}$") duration: string | null;
}

model SleepStatsData {
  week: SleepStatsPeriod;
  month: SleepStatsPeriod;
  year: SleepStatsPeriod;
}

model SleepStatsResponse {
  @statusCode statusCode: 200;
  @body body: SleepStatsData;
}

@route("/sleep-records")
@useAuth(BearerAuth)
interface SleepRecords {
  /** Existing records for today and the previous four days in Moscow, newest first. */
  @get getSleepRecords(): SleepRecordsResponse | UnauthorizedResponse | InternalErrorResponse;

  @get @route("/{date}") getSleepRecord(@path date: CalendarDate): DailyEntryResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  /** Creates or replaces sleep data. Duration uses the previous day's bedtime and this day's wake time. */
  @put @route("/{date}") putSleepRecord(@path date: CalendarDate, @body body: SleepDataInput): DailyEntryResponse | UnauthorizedResponse | InternalErrorResponse;

  /** Creates the daily entry if absent. The habit key need not exist in the habit list. */
  @patch @route("/{date}/habits/{habitKey}") setDailyHabitMark(@path date: CalendarDate, @path habitKey: string, @body body: DailyHabitMarkInput): DailyEntryResponse | UnauthorizedResponse | InternalErrorResponse;

  /** Removing an absent mark succeeds when the daily entry exists. */
  @delete @route("/{date}/habits/{habitKey}") removeDailyHabitMark(@path date: CalendarDate, @path habitKey: string): DailyEntryResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  /** True only when the day before yesterday has bedtime and yesterday has wake time in Moscow calendar dates. */
  @get @route("/yesterday/check") checkYesterday(): CheckYesterdayResponse | UnauthorizedResponse | InternalErrorResponse;
}

@route("/sleep-stats")
@useAuth(BearerAuth)
interface SleepStats {
  /** Sleep averages for the last seven and thirty days, and the previous twelve completed calendar months. Periods without complete sleep return null values. */
  @get getSleepStats(): SleepStatsResponse | UnauthorizedResponse | InternalErrorResponse;
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

  /** An existing derived key returns its original habit with status 201. */
  @post createHabit(@body body: HabitInput): CreatedHabitResponse | UnauthorizedResponse | InternalErrorResponse;

  @patch @route("/{key}") updateHabit(@path key: string, @body body: HabitInput): UpdatedHabitResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  @delete @route("/{key}") deleteHabit(@path key: string): DeletedHabitResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;
}
