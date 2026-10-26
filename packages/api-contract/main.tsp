import "@typespec/http";

using TypeSpec.Http;

@service(#{ title: "Sadhana API" })
namespace Sadhana;

model HabitDefinition {
  key: string;
  label: string;
  /** Original local creation timestamp; unknown legacy timestamps remain null. */
  createdAt: string | null;
  @pattern("^\\d{4}-\\d{2}-\\d{2}$") startDate: string | null;
  archived: boolean;
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
  @minLength(1) @maxLength(255) label: string;
}

model HabitCreateInput {
  ...HabitInput;
  creationDate: CalendarDate;
}

model HabitDeletionSummary {
  key: string;
  label: string;
  markCount: int32;
}

model HabitDeletionSummaryResponse {
  @statusCode statusCode: 200;
  @body body: HabitDeletionSummary;
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
  /** refreshToken cookie: HttpOnly; Path=/; Max-Age=604800. When x-forwarded-proto is https, use Secure and SameSite=None; otherwise use SameSite=Lax without Secure. */
  @header("Set-Cookie") setCookie: string;
  @body body: AuthResponse;
}

model AuthenticatedResponse {
  @statusCode statusCode: 200;
  /** refreshToken cookie: HttpOnly; Path=/; Max-Age=604800. When x-forwarded-proto is https, use Secure and SameSite=None; otherwise use SameSite=Lax without Secure. */
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
  /** Original nonnegative minutes; absent nap is null. */
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

enum StatisticsGranularity { day, week, month, year }

model SleepMetric {
  value: float64 | null;
  sum: float64;
  count: int32;
}

enum HabitDayState { done, failed, unmarked, notApplicable }

model HabitStatisticsValue {
  habitId: string;
  state?: HabitDayState;
  successRate: float64 | null;
  completeness: float64 | null;
  trueCount: int32;
  falseCount: int32;
  eligibleDayCount: int32 | null;
}

model SleepStatisticsColumn {
  from: CalendarDate;
  toExclusive: CalendarDate;
  source?: SleepData;
  habits: HabitStatisticsValue[];
  bedtime: SleepMetric;
  wakeTime: SleepMetric;
  nap: SleepMetric;
  duration: SleepMetric;
}

model StatisticsData {
  granularity: StatisticsGranularity;
  from: CalendarDate;
  toExclusive: CalendarDate;
  asOfDate: CalendarDate;
  historyFrom: CalendarDate;
  habits: HabitDefinition[];
  columns: SleepStatisticsColumn[];
}

model StatisticsResponse {
  @statusCode statusCode: 200;
  @body body: StatisticsData;
}

@route("/sleep-records")
@useAuth(BearerAuth)
interface SleepRecords {
  /** Existing records for today and the previous four days in Moscow, newest first. */
  @get getSleepRecords(): SleepRecordsResponse | UnauthorizedResponse | InternalErrorResponse;

  @get @route("/{date}") getSleepRecord(@path date: CalendarDate): DailyEntryResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  /** Creates or replaces sleep data. Duration uses the previous day's bedtime and this day's wake time. */
  @put @route("/{date}") putSleepRecord(@path date: CalendarDate, @body body: SleepDataInput): DailyEntryResponse | BadRequestResponse | UnauthorizedResponse | InternalErrorResponse;

  /** Creates the daily entry if absent. The habit UUID must belong to the authenticated user. */
  @patch @route("/{date}/habits/{habitKey}") setDailyHabitMark(@path date: CalendarDate, @path habitKey: string, @body body: DailyHabitMarkInput): DailyEntryResponse | BadRequestResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  /** Removing an absent mark succeeds when the daily entry exists. */
  @delete @route("/{date}/habits/{habitKey}") removeDailyHabitMark(@path date: CalendarDate, @path habitKey: string): DailyEntryResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  /** True only when the day before yesterday has bedtime and yesterday has wake time in Moscow calendar dates. */
  @get @route("/yesterday/check") checkYesterday(): CheckYesterdayResponse | UnauthorizedResponse | InternalErrorResponse;
}

@route("/statistics")
@useAuth(BearerAuth)
interface Statistics {
  /** Calendar-aligned bounded history. The device supplies today's date; no server timezone conversion. */
  @get getStatistics(
    @query granularity: StatisticsGranularity,
    @query from: CalendarDate,
    @query toExclusive: CalendarDate,
    @query asOfDate: CalendarDate,
    @query includeArchived?: boolean,
    @query habitId?: string
  ): StatisticsResponse | BadRequestResponse | UnauthorizedResponse | InternalErrorResponse;
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
  /** List active and archived habits of the authenticated user in creation order. */
  @get getHabits(): HabitsResponse | UnauthorizedResponse | InternalErrorResponse;

  /** Always creates a new UUID, even when the label has been used before. */
  @post createHabit(@body body: HabitCreateInput): CreatedHabitResponse | BadRequestResponse | UnauthorizedResponse | InternalErrorResponse;

  @patch @route("/{key}") updateHabit(@path key: string, @body body: HabitInput): UpdatedHabitResponse | BadRequestResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  @post @route("/{key}/archive") archiveHabit(@path key: string): UpdatedHabitResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  @post @route("/{key}/restore") restoreHabit(@path key: string): UpdatedHabitResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  @get @route("/{key}/deletion-summary") getHabitDeletionSummary(@path key: string): HabitDeletionSummaryResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;

  @delete @route("/{key}") deleteHabit(@path key: string): DeletedHabitResponse | UnauthorizedResponse | NotFoundResponse | InternalErrorResponse;
}
