export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "AppError";
  }
}

export const Errors = {
  invalidInput: (message: string) => new AppError(400, "INVALID_INPUT", message),
  unauthorized: () => new AppError(401, "UNAUTHORIZED", "Authentication is required."),
  notFound: (what: string) => new AppError(404, "NOT_FOUND", `${what} was not found.`),
  slotTaken: () =>
    new AppError(
      409,
      "SLOT_TAKEN",
      "This resource is no longer available for the selected time. Please choose another time."
    ),
  pastBooking: () => new AppError(400, "BOOKING_IN_PAST", "Bookings cannot be made in the past."),
  invalidRange: (message: string) => new AppError(400, "INVALID_TIME_RANGE", message),
  cancellationWindowClosed: () =>
    new AppError(
      409,
      "CANCELLATION_WINDOW_CLOSED",
      "This booking can no longer be cancelled (less than 1 minute before start, or it has already started)."
    ),
  alreadyCancelled: () => new AppError(409, "ALREADY_CANCELLED", "This booking is already cancelled."),
  emailTaken: () =>
    new AppError(409, "EMAIL_TAKEN", "An account with this email already exists. Try logging in instead."),
  invalidCredentials: () =>
    new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect."),
  weakPassword: () =>
    new AppError(400, "WEAK_PASSWORD", "Password must be at least 8 characters long."),
  forbidden: (message = "You do not have permission to do that.") => new AppError(403, "FORBIDDEN", message),
  accountInactive: () =>
    new AppError(403, "ACCOUNT_INACTIVE", "This account has been deactivated. Contact an administrator."),
  invalidOrExpiredToken: () =>
    new AppError(400, "INVALID_OR_EXPIRED_TOKEN", "This reset link is invalid or has expired."),
  passwordMismatch: () => new AppError(400, "PASSWORD_MISMATCH", "Passwords do not match."),
  incorrectPassword: () => new AppError(400, "INCORRECT_PASSWORD", "Current password is incorrect."),
  resourceUnavailable: (status: string) =>
    new AppError(
      409,
      "RESOURCE_UNAVAILABLE",
      status === "MAINTENANCE"
        ? "This resource is currently under maintenance and cannot be booked."
        : "This resource is currently unavailable."
    ),
  resourceHasBookings: () =>
    new AppError(
      409,
      "RESOURCE_HAS_BOOKINGS",
      "This resource has existing bookings and cannot be deleted. Disable it instead."
    )
};
