// Reservations expose dates as UTC ISO strings. The hotel's calendar determines which day is today.
export function hotelCalendarDay(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
