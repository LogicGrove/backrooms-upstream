import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminAccount } from '../server/src/admin-access';
import { softwareRenderer, renderRatio } from '../client/src/game/render-budget';
test('admin is disabled without an explicitly configured account ID', () => {
 assert.equal(isAdminAccount(1,''),false); assert.equal(isAdminAccount(1,'1'),true);
 for(const id of ['0','-1','NaN','Infinity','1e0','1.5']) assert.equal(isAdminAccount(1,id),false);
 assert.equal(isAdminAccount(2,'1'),false);
});
test('Windows CPU renderer gets a bounded budget while hardware keeps its settings', () => {
 assert.equal(softwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver)'),true);
 assert.equal(softwareRenderer('Intel UHD Graphics'),false);
 assert.ok(renderRatio(1920,1080,2,false,true,1)*1920<=360);
 assert.equal(renderRatio(1920,1080,2,false,false,1),1);
});
