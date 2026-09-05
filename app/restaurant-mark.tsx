import type { Restaurant } from "./types";

export function RestaurantMark({ restaurant, large = false }: { restaurant: Restaurant; large?: boolean }) {
  return (
    <div className={`restaurant-mark ${restaurant.tone} ${large ? "large" : ""}`}>
      <span>{restaurant.mark}</span>
      <i />
    </div>
  );
}

