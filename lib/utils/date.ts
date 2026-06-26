export const formatReleaseDate = (date?: string): string => {
  if (!date) {
    return "発売日未定";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
};

export const isSoonRelease = (date?: string): boolean => {
  if (!date) {
    return false;
  }

  const today = new Date();
  const releaseDate = new Date(date);
  const daysUntilRelease =
    (releaseDate.getTime() - startOfDay(today).getTime()) / 86_400_000;

  return daysUntilRelease >= 0 && daysUntilRelease <= 7;
};

const startOfDay = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
