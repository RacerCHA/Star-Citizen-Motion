// SPDX-License-Identifier: GPL-3.0-or-later
// MOZA's installed DCS exporter uses key,value; records. See docs/moza.md.
export const DCS_KEYS = ('aircraft_name engine_rpm_left engine_rpm_right left_gear nose_gear right_gear acc_x acc_y acc_z wind_x wind_y wind_z vector_velocity_x vector_velocity_y vector_velocity_z tas ias vertical_velocity_speed aoa heading pitch bank aos euler_vx euler_vy euler_vz canopy_pos flap_pos gear_value speedbrake_value wheelbrakesPos afterburner_1 afterburner_2 weapon flare chaff cannon_shells mach h_above_sea_level led_console led_instruments_result light_apu_ready light_gear_warning light_gear_indicator helicopter_rotor_rpm helicopter_rotor_rpm_ratio').split(' ');
export const G = 9.80665;
const vector = v => v && ['x','y','z'].every(k=>Number.isFinite(v[k]));
const field = (e,id) => e.values?.[e.meanings?.indexOf(id)];
const numeric = (e,id,fallback=0) => Number.isFinite(field(e,id)) ? field(e,id) : fallback;
const magnitude = v => Array.isArray(v)&&v.length===3&&v.every(Number.isFinite) ? Math.hypot(...v) : 0;
const unit = n => Math.max(0,Math.min(1,n)); // Only normalized actuator/effect channels, never motion vectors.

export class MozaEncoder {
  constructor({aircraft='A-10C_2',shipSpeedScale=650,dcsSpeedScale=231.5,staleMs=350}={}) {
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(aircraft))throw Error('Invalid DCS aircraft identifier');
    if(![shipSpeedScale,dcsSpeedScale,staleMs].every(n=>Number.isFinite(n)&&n>0))throw Error('Invalid MOZA scale/timeout');
    Object.assign(this,{aircraft,shipSpeedScale,dcsSpeedScale,staleMs});this.reset();
  }
  reset() {
    this.session=null;this.lastSeq=-1;this.ship='';this.frame=null;this.frameAt=-Infinity;
    this.role=null;this.roleAt=-Infinity;this.leftVehicle=false;this.boost=0;this.atmosphere=0;
    this.vibrationAt=-Infinity;this.impactUntil=-Infinity;this.impact=0;
    this.shells=1000000;this.missiles=10000;this.weaponEvents=0;this.ordnanceEvents=0;
    this.eventCounts={};this.lastUnsupported=null;
  }
  isActive(now) {return !!this.frame&&!this.leftVehicle&&this.role===1&&now-this.frameAt<=this.staleMs&&now-this.roleAt<=this.staleMs;}
  ingest(e,now) {
    if(e.source!=='star-citizen-dbox'||e.schema_version!==1||!e.mapping_valid||!Number.isFinite(now))return false;
    const session=e.session_id+':'+e.stream_id;
    if(session!==this.session){this.reset();this.session=session;}
    if(Number.isFinite(e.seq)){if(e.seq<=this.lastSeq)return false;this.lastSeq=e.seq;}
    this.eventCounts[e.event_key]=(this.eventCounts[e.event_key]||0)+1;
    if(e.event_key===1){
      const key=this.session,seq=this.lastSeq;this.reset();this.session=key;this.lastSeq=seq;
      this.ship=typeof field(e,30)==='string'?field(e,30):'';return true;
    }
    if(e.event_key===2){this.leftVehicle=true;this.role=0;this.frame=null;return true;}
    if(e.event_key===10){this.role=numeric(e,38,-1);this.roleAt=now;return true;}
    if(e.event_key===3){
      if(![e.acceleration_m_s2,e.angular_velocity_rad_s,e.velocity_m_s].every(vector)){this.frame=null;return true;}
      this.frame=e;this.frameAt=now;this.leftVehicle=false;return true;
    }
    if(e.event_key===4){this.boost=numeric(e,41);this.atmosphere=numeric(e,43);this.vibrationAt=now;return false;}
    if(!this.isActive(now))return false;
    if(e.event_key===5){this.shells=Math.max(0,this.shells-1);this.weaponEvents++;return true;}
    if(e.event_key===6){this.missiles=Math.max(0,this.missiles-1);this.ordnanceEvents++;return true;}
    if(e.event_key===7||e.event_key===8){
      // Event-triggered rumble, not a claim to know hull health or damage location.
      this.impact=unit(Math.abs(numeric(e,104,1)));this.impactUntil=now+180;return true;
    }
    if([9,11,13,15,16,17,18,19].includes(e.event_key))this.lastUnsupported=e.event_name;
    return false;
  }
  snapshot(now) {
    if(!this.isActive(now))return {active:false,frame:'export_stop,true;'};
    const e=this.frame,a=e.acceleration_m_s2,w=e.angular_velocity_rad_s,v=e.velocity_m_s;
    const speed=Math.hypot(v.x,v.y,v.z),tas=speed*this.dcsSpeedScale/this.shipSpeedScale;
    const powered=numeric(e,4)>0.5,effort=magnitude(field(e,38))/G;
    const rumble=now<this.impactUntil?this.impact:0;
    const ambient=now-this.vibrationAt<=this.staleMs?unit(Math.abs(this.atmosphere)):0;
    const engine=powered?15+85*(effort/(1+effort)):0;
    const rpm=engine+(100-engine)*Math.max(rumble,ambient);
    const gear=unit(numeric(e,92));
    const out=Object.fromEntries(DCS_KEYS.map(k=>[k,0]));
    Object.assign(out,{
      aircraft_name:this.aircraft,engine_rpm_left:rpm,engine_rpm_right:rpm,
      gear_value:gear,left_gear:gear,nose_gear:gear,right_gear:gear,
      // SC body right/forward/up -> DCS body forward/up/right. No clipping or smoothing.
      acc_x:a.y/G,acc_y:a.z/G,acc_z:a.x/G,
      euler_vx:w.y,euler_vy:w.z,euler_vz:w.x,
      tas,ias:tas,
      // Deliberate virtual-aircraft cues. No wind, air density or absolute attitude exists here.
      aoa:speed>1?Math.atan2(-v.z,Math.hypot(v.x,v.y))*180/Math.PI:0,
      aos:speed>1?Math.atan2(v.x,Math.abs(v.y))*180/Math.PI:0,
      mach:speed/340.29,
      afterburner_1:now-this.vibrationAt<=this.staleMs?unit(this.boost):0,
      afterburner_2:now-this.vibrationAt<=this.staleMs?unit(this.boost):0,
      cannon_shells:this.shells,
      weapon:'SC-Ordnance-4.4.7.31*'+this.missiles,
      light_gear_indicator:gear,light_apu_ready:+powered
    });
    // World velocity, altitude, attitude, trim, countermeasures and mechanisms without
    // a verified input remain neutral. A body-axis velocity is not world vertical speed.
    const frame=DCS_KEYS.map(k=>k+','+out[k]+';').join('');
    return {active:true,frame,values:out,ship:this.ship,raw_speed_m_s:speed,adapted_tas:tas,
      weapon_events:this.weaponEvents,ordnance_events:this.ordnanceEvents};
  }
}
