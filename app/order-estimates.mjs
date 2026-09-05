/**
 * Keep each minimum and delivery estimate on the same delivery platform.
 * @param {{apps: ('baemin'|'coupang')[],total:number,people:number,membership:string}} room
 * @param {{minimum:Record<'baemin'|'coupang',number>,deliveryFee:Record<'baemin'|'coupang',number>}} restaurant
 */
export function getAppEstimates(room, restaurant) {
  return room.apps.map(app => {
    const minimum = restaurant.minimum[app];
    const remaining = Math.max(0, minimum - room.total);
    const membershipApplied = room.membership === app;
    const fee = membershipApplied ? 0 : restaurant.deliveryFee[app];
    return { app, minimum, remaining, ready: remaining === 0, membershipApplied,
      fee, eachFee: Math.ceil(fee / Math.max(1, room.people)) };
  });
}
