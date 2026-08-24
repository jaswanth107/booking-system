interface Props {
  message?: string;
}

export function SlotTakenNotice({ message }: Props) {
  return (
    <div className="notice notice-error" data-testid="slot-taken-notice">
      <strong>Slot taken</strong>
      <p>
        {message ??
          "This resource is no longer available for the selected time. Please choose another time."}
      </p>
    </div>
  );
}
