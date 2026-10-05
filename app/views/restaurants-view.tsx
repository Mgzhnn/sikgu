"use client";

import { useState } from "react";
import type { DeliveryApp, Restaurant } from "../types";
import { restaurants, appLabels } from "../catalog";
import { money, kakaoMapSearchUrl } from "../room-ui";
import { RestaurantMark } from "../restaurant-mark";
import { Header } from "../components/header";

export function RestaurantsView({
  onCreate,
}: {
  onCreate: (restaurant?: Restaurant) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("전체");
  const filters = ["전체", "위치 확인 매장", "최소금액 낮은 순"];
  const visible = restaurants
    .filter((restaurant) =>
      `${restaurant.name} ${restaurant.cuisine} ${restaurant.address || ""} ${restaurant.menu.flatMap((group) => group.items).map((item) => item.name).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()))
    .filter((restaurant) => filter !== "위치 확인 매장" || restaurant.verified)
    .sort((a, b) => filter === "최소금액 낮은 순"
      ? Math.min(...Object.values(a.minimum)) - Math.min(...Object.values(b.minimum))
      : 0);

  return (
    <>
      <Header title="현풍에서 오늘 뭐 먹을까요?" subtitle={`테크노폴리스 상권 · ${restaurants.length}개 가게`} onCreate={() => onCreate()} />
      <div className="restaurant-directory-note">
        <div>
          <span>LOCAL DIRECTORY</span>
          <strong>현풍·유가 테크노폴리스 상권을 기준으로 정리했어요.</strong>
        </div>
        <p>배달 가능 여부와 최소주문·배달비는 시간과 주소에 따라 달라져요. 결제 전 배민·쿠팡이츠에서 한 번 더 확인해 주세요.</p>
      </div>
      <div className="restaurant-toolbar">
        <label className="search-box">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="가게·메뉴·카테고리 검색"
            aria-label="가게와 메뉴 검색"
          />
        </label>
        <div className="category-tabs compact-tabs">
          {filters.map((item) => (
            <button
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
              aria-pressed={filter === item}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <section className="restaurant-list">
        {visible.map((restaurant) => {
          const bestApp: DeliveryApp = restaurant.minimum.baemin <= restaurant.minimum.coupang ? "baemin" : "coupang";
          return (
            <article className="restaurant-card" key={restaurant.id}>
              <div className="restaurant-summary">
                <RestaurantMark restaurant={restaurant} large />
                <div className="restaurant-info">
                  <span className="cuisine-label">{restaurant.cuisine}{restaurant.verified && <em>위치 확인</em>}</span>
                  <h2>{restaurant.name}</h2>
                  <p>테크노폴리스 상권 · {restaurant.eta}</p>
                </div>
              </div>
              <a className="restaurant-location-link" href={kakaoMapSearchUrl(restaurant)} target="_blank" rel="noreferrer">
                <span>◎</span>{restaurant.address || "현풍 테크노폴리스"}<b>카카오맵 ↗</b>
              </a>
              <div className="app-price-compare">
                {(["baemin", "coupang"] as DeliveryApp[]).map((app) => (
                  <div className={bestApp === app ? "best" : ""} key={app}>
                    <span>{appLabels[app].name}{bestApp === app && <em>LOW</em>}</span>
                    <strong>예상 {money(restaurant.minimum[app])}부터</strong>
                    <small>예상 배달 {money(restaurant.deliveryFee[app])}</small>
                  </div>
                ))}
              </div>
              <div className="restaurant-card-actions">
                <button className="primary-button" onClick={() => onCreate(restaurant)}>이 가게로 방 만들기</button>
              </div>
            </article>
          );
        })}
      </section>
      {!visible.length && (
        <div className="empty-state restaurant-empty">
          <span>⌕</span>
          <h3>검색 결과가 없어요</h3>
          <p>다른 가게 이름이나 메뉴로 다시 찾아보세요.</p>
        </div>
      )}
    </>
  );
}
