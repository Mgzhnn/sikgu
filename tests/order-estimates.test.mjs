import assert from 'node:assert/strict';
import test from 'node:test';
import {getAppEstimates} from '../app/order-estimates.mjs';

test('R8: readiness and membership fees always belong to the same app',()=>{
  for(const minimum of [{baemin:15000,coupang:18000},{baemin:18000,coupang:15000}]){
    for(const membership of ['', 'baemin','coupang']){
      for(const apps of [['baemin'],['coupang'],['baemin','coupang']]){
        const rows=getAppEstimates({apps,total:15000,people:2,membership},{minimum,deliveryFee:{baemin:3000,coupang:2500}});
        for(const row of rows){
          assert.equal(row.ready,minimum[row.app]===15000);
          assert.equal(row.remaining,minimum[row.app]-15000);
          assert.equal(row.fee,membership===row.app?0:row.app==='baemin'?3000:2500);
        }
      }
    }
  }
});
