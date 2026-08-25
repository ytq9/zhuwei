type LocatedMessage = {
  id: string;
  user_id: string | null;
  kind?: string;
  name?: string;
  body?: string;
  meta: unknown;
};

function readMeta(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function placesOf(message: LocatedMessage) {
  const meta = readMeta(message.meta);
  const listed = Array.isArray(meta.places)
    ? meta.places.map(String).filter(Boolean)
    : [];
  const single = meta.place ? String(meta.place) : "";
  const places = listed.length ? listed : single ? [single] : ["all"];
  return [...new Set(places)];
}

function experiencedRows<T extends LocatedMessage>(
  rows: T[],
  userId: string,
  currentPlace: string,
  userNames: string[],
) {
  const experienced = new Set<string>();
  let inferredPlace = currentPlace;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const places = placesOf(row);
    const specificPlaces = places.filter((place) => place !== "all");
    if (row.user_id === userId && specificPlaces.length === 1) {
      inferredPlace = specificPlaces[0];
    }
    const audience = readMeta(row.meta).audience;
    const explicitlyExperienced = Array.isArray(audience)
      ? audience.map(String).includes(userId)
      : null;
    if (
      row.user_id === userId ||
      places.includes("all") ||
      explicitlyExperienced === true ||
      (explicitlyExperienced === null && places.includes(inferredPlace))
    ) {
      experienced.add(row.id);
    }
    const isMyLegacyMove =
      row.kind === "stage" &&
      row.name === "去向" &&
      userNames.some((name) => name && row.body?.includes(name)) &&
      specificPlaces.length >= 2 &&
      specificPlaces.at(-1) === inferredPlace;
    if (isMyLegacyMove) {
      inferredPlace = specificPlaces.find((place) => place !== inferredPlace) ?? inferredPlace;
    }
  }
  return rows.filter((row) => experienced.has(row.id));
}

export function projectLocationMessages<T extends LocatedMessage>({
  rows,
  userId,
  currentPlace,
  visitedPlaces,
  labels,
  userNames = [],
}: {
  rows: T[];
  userId: string;
  currentPlace: string;
  visitedPlaces: string[];
  labels: Record<string, string>;
  userNames?: string[];
}) {
  const experienced = experiencedRows(rows, userId, currentPlace, userNames);
  const current = experienced.filter((row) => {
    const places = placesOf(row);
    return places.includes("all") || places.includes(currentPlace);
  });
  const history = [...new Set(visitedPlaces)]
    .filter((placeId) => placeId && placeId !== "all" && placeId !== currentPlace)
    .map((placeId) => ({
      placeId,
      name: labels[placeId] ?? placeId,
      messages: experienced.filter((row) => placesOf(row).includes(placeId)),
    }))
    .filter((thread) => thread.messages.length > 0);

  return { current, history };
}
