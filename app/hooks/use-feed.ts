"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AuthUser, Pool, PoolFilters } from "../types";
import { restaurants, pickupPoints, initialPools, defaultPoolFilters } from "../catalog";
import { browserPoll } from "../room-ui";
import { apiGet } from "../lib/api";
import { mergeById } from "../lib/pool-status";
import { captureIncomingInvite, resumeContinuations, type PendingInvite } from "../continuations";
import type { Session } from "./use-session";

type BootstrapData = {
  user: AuthUser | null;
  rooms: Pool[];
  myRooms?: Pool[];
  serverNow?: number;
  nextRoomsCursor?: string | null;
  nextMyRoomsCursor?: string | null;
};

/**
 * The live feed: the pools and the viewer's rooms, their history cursors,
 * the server query built from the search controls, the 30-second poll, and
 * the server-clock offset every countdown is drawn from.
 */
export function useFeed({
  currentPickup,
  session,
  incomingInviteRef,
  showInvite,
  openRoom,
}: {
  currentPickup: string;
  session: Session;
  /** An invitation captured before bootstrap, kept until the viewer accepts or dismisses it. */
  incomingInviteRef: RefObject<PendingInvite | null>;
  showInvite: (invite: PendingInvite) => void;
  openRoom: (roomId: string) => void;
}) {
  const { setUser, setBootstrapState, setBootstrapError, notify, signIn } = session;
  const [pools, setPools] = useState<Pool[]>(initialPools);
  const [myRooms, setMyRooms] = useState<Pool[]>([]);
  const [nextRoomsCursor,setNextRoomsCursor]=useState<string | null>(null);
  const [nextMyRoomsCursor,setNextMyRoomsCursor]=useState<string | null>(null);
  const [loadingMore,setLoadingMore]=useState<string | null>(null);
  const loadedFeedHistoryRef=useRef(false), loadedMyHistoryRef=useRef(false);
  const lastFeedQueryRef=useRef("");
  const [search, setSearch] = useState("");
  // The server query follows the search box after a pause: wiring it directly
  // restarted bootstrap and polling on every keystroke (one per jamo with a
  // Korean IME). The list itself filters on `search` immediately.
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const [category, setCategory] = useState("전체");
  const [filters, setFilters] = useState<PoolFilters>(defaultPoolFilters);
  const [now, setNow] = useState(() => Date.now());
  const loadRoomsRequestRef = useRef(0);
  // Server time minus device time, learned from every feed load, so that a
  // phone whose clock is minutes off still shows the right countdown.
  const clockOffsetRef = useRef(0);
  const serverNow = useCallback(() => Date.now() + clockOffsetRef.current, []);

  const feedQuery = useMemo(() => {
    const query=new URLSearchParams({action:"bootstrap",sort:filters.sortBy});
    if(category!=="전체")query.set("categoryIds",restaurants.filter(r=>r.cuisine===category).map(r=>r.id).join(","));
    const term=searchTerm.trim().toLowerCase();
    if(term){
      query.set("searchRestaurants",restaurants.filter(r=>r.name.toLowerCase().includes(term)).map(r=>r.id).join(","));
      query.set("searchPickups",pickupPoints.filter(p=>p.full.toLowerCase().includes(term)).map(p=>p.id).join(","));
    }
    if(filters.currentPickupOnly)query.set("pickup",currentPickup);
    if(filters.availableOnly)query.set("available","1");
    return query.toString();
  },[category,searchTerm,filters,currentPickup]);

  const loadRooms = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRoomsRequestRef.current;
    const { response, data } = await apiGet<BootstrapData>(feedQuery, signal);
    if (!response.ok) throw new Error(data.error || "주문방을 불러오지 못했어요.");
    if (!signal?.aborted && requestId === loadRoomsRequestRef.current) {
      if (typeof data.serverNow === "number") {
        clockOffsetRef.current = data.serverNow - Date.now();
        setNow(data.serverNow);
      }
      const isValidRoom = (room: Pool) => (
        restaurants.some((restaurant) => restaurant.id === room.restaurantId)
        && pickupPoints.some((point) => point.id === room.pickup)
        && room.apps.length > 0
      );
      setUser(data.user);
      if (data.user && incomingInviteRef.current) showInvite(incomingInviteRef.current);
      if(lastFeedQueryRef.current!==feedQuery){loadedFeedHistoryRef.current=false;lastFeedQueryRef.current=feedQuery;}
      const fresh=(data.rooms || []).filter(isValidRoom), mine=(data.myRooms || []).filter(isValidRoom);
      // The unfiltered response is the source of truth; history pages loaded
      // earlier are kept only while they belong to the same query.
      setPools(previous=>loadedFeedHistoryRef.current ? mergeById(previous.filter(r=>r.closesAt>serverNow()),fresh) : fresh);
      setMyRooms(previous=>loadedMyHistoryRef.current ? mergeById(previous.filter(r=>r.closesAt>serverNow()-30*86400000),mine) : mine);
      if(!loadedFeedHistoryRef.current)setNextRoomsCursor(data.nextRoomsCursor ?? null);
      if(!loadedMyHistoryRef.current)setNextMyRoomsCursor(data.nextMyRoomsCursor ?? null);
      setBootstrapError("");
      setBootstrapState("ready");
    }
    return data;
  }, [feedQuery,serverNow,setUser,setBootstrapError,setBootstrapState,incomingInviteRef,showInvite]);

  const loadMoreRooms = async (kind: "feed" | "mine") => {
    const cursor=kind==="feed"?nextRoomsCursor:nextMyRoomsCursor;
    if(!cursor || loadingMore)return;
    // A background poll must not discard this page: only a changed query
    // makes the response stale, and merging by id keeps either order correct.
    const issuedQuery=feedQuery;
    setLoadingMore(kind);
    try {
      const query=new URLSearchParams(feedQuery);
      query.set(kind==="feed"?"roomsCursor":"myRoomsCursor",cursor);
      const {response,data}=await apiGet<{rooms?:Pool[];myRooms?:Pool[];nextRoomsCursor?:string|null;nextMyRoomsCursor?:string|null}>(query.toString());
      if(!response.ok)throw new Error(data.error || "이전 주문방을 불러오지 못했어요.");
      if(issuedQuery!==lastFeedQueryRef.current)return;
      if(kind==="feed"){
        loadedFeedHistoryRef.current=true;
        setPools(previous=>mergeById(previous,data.rooms || []));
        setNextRoomsCursor(data.nextRoomsCursor ?? null);
      }else{
        loadedMyHistoryRef.current=true;
        setMyRooms(previous=>mergeById(previous,data.myRooms || []));
        setNextMyRoomsCursor(data.nextMyRoomsCursor ?? null);
      }
    }catch(error){notify(error instanceof Error?error.message:"더 불러오지 못했어요.","error");}
    finally{setLoadingMore(null);}
  };

  // Background refreshes after room actions: a failed bootstrap must not
  // surface as an unhandled rejection; the next poll retries anyway.
  const refreshRooms = useCallback(() => loadRooms().catch(() => undefined), [loadRooms]);

  /** Shows a request as sent before the next feed load confirms it. */
  const markRequested = useCallback((roomId: string) => {
    setPools((currentPools) => currentPools.map((pool) => (
      pool.id === roomId ? { ...pool, myStatus: "requested" } : pool
    )));
  }, []);

  const retryBootstrap = () => {
    setBootstrapState("loading");
    setBootstrapError("");
    void loadRooms().catch((error) => {
      setBootstrapState("error");
      setBootstrapError(error instanceof Error ? error.message : "네트워크 연결을 확인해주세요.");
    });
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), 30000);
    return () => window.clearInterval(timer);
  }, [serverNow]);

  useEffect(() => {
    let active = true;
    const controller=new AbortController();
    const requests=loadRoomsRequestRef;
    const initialize = async () => {
      incomingInviteRef.current ||= captureIncomingInvite();
      let data: Awaited<ReturnType<typeof loadRooms>>;
      try {
        data = await loadRooms(controller.signal);
      } catch (loadError) {
        if (!active) return;
        setBootstrapState("error");
        setBootstrapError(loadError instanceof Error ? loadError.message : "네트워크 연결을 확인해주세요.");
        return;
      }
      if (!active) return;

      try {
        await resumeContinuations(data, {
          invite: incomingInviteRef.current,
          signIn,
          notify,
          showInvite,
          openRoom,
          markRequested,
          loadRooms,
        });
      } catch (interactionError) {
        if (active) {
          notify(
            interactionError instanceof Error ? interactionError.message : "요청을 처리하지 못했어요.",
            "error",
          );
        }
      }
    };
    void initialize();
    const stop = browserPoll(async signal => { setNow(serverNow()); await loadRooms(signal); },30000);
    return () => {
      active = false;
      controller.abort();
      requests.current++;
      stop();
    };
  }, [loadRooms, notify, signIn, serverNow, incomingInviteRef, showInvite, openRoom, markRequested, setBootstrapState, setBootstrapError]);

  return {
    pools,
    setPools,
    myRooms,
    setMyRooms,
    now,
    search,
    setSearch,
    category,
    setCategory,
    filters,
    setFilters,
    nextRoomsCursor,
    nextMyRoomsCursor,
    loadingMore,
    loadRooms,
    loadMoreRooms,
    refreshRooms,
    markRequested,
    retryBootstrap,
  };
}
