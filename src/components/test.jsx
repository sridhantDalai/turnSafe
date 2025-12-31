import React, { useEffect, useRef, useState } from "react";
import {
  GoogleMap,
  Marker,
  DirectionsRenderer,
  useLoadScript,
} from "@react-google-maps/api";
import "./scss/test.scss";

const containerStyle = { width: "100%", height: "100vh" };
const FALLBACK_LOCATION = { lat: 20.5937, lng: 78.9629 };
const LOCKED_ZOOM = 15;

// SPEED FILTER
const MIN_MOVE_METERS = 1.5;
const MIN_TIME_SEC = 1;
const SPEED_SMOOTHING = 0.2;
const STOP_SPEED = 2;
const MAX_NORMAL_SPEED = 80;

// TESTER
const TESTER_MIN_SPEED = 1;
const TESTER_MAX_SPEED = 120;

export default function Home() {
  const [location, setLocation] = useState(FALLBACK_LOCATION);
  const [destination, setDestination] = useState(null);
  const [destInput, setDestInput] = useState("");
  const [directions, setDirections] = useState(null);
  const [speed, setSpeed] = useState(0);

  const [turnDistance, setTurnDistance] = useState(null);
  const [maxSafeSpeed, setMaxSafeSpeed] = useState(null);
  const [isOverspeedForTurn, setIsOverspeedForTurn] = useState(false);

  // TESTER STATE
  const [testerActive, setTesterActive] = useState(false);
  const [testerSpeed, setTesterSpeed] = useState(10);

  const pathRef = useRef([]);
  const segIndex = useRef(0);
  const segProgress = useRef(0);
  const lastFrame = useRef(null);

  const lastPos = useRef(null);
  const lastTime = useRef(null);
  const smoothSpeed = useRef(0);
  const lastRouteOrigin = useRef(null);

  const mapRef = useRef(null);
  const hasCenteredOnce = useRef(false);

  //stop
  const rafId = useRef(null);
  const pausedAt = useRef(false);


  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
  });

  /* ================= ME BUTTON ================= */
  const handleMeClick = () => {
    if (!mapRef.current) return;
    mapRef.current.panTo(location);
    mapRef.current.setZoom(18);
  };

  /* ================= DESTINATION ================= */
  const handleGo = () => {
    if (!isLoaded || !destInput.trim()) return;
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: destInput, region: "IN" }, (res, status) => {
      if (status === "OK" && res.length) {
        const loc = res[0].geometry.location;
        setDestination({ lat: loc.lat(), lng: loc.lng() });
        setDirections(null);
        lastRouteOrigin.current = null;
        setTesterActive(false);
      }
    });
  };

  const handleTesterStop = () => {
  pausedAt.current = true;
  setTesterActive(false);
  lastFrame.current = null; // ⛔ prevents jump on resume
  cancelAnimationFrame(rafId.current);
};


  /* ================= GPS (OFF DURING TESTER) ================= */
  useEffect(() => {
    if (!navigator.geolocation || testerActive) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed: gpsSpeed } = pos.coords;
        const now = pos.timestamp;
        const newLoc = { lat: latitude, lng: longitude };
        setLocation(newLoc);

        let rawSpeed = 0;
        if (gpsSpeed != null && gpsSpeed > 0) {
          rawSpeed = gpsSpeed * 3.6;
        } else if (lastPos.current && lastTime.current) {
          const d = distance(
            lastPos.current.lat,
            lastPos.current.lng,
            latitude,
            longitude
          );
          const t = (now - lastTime.current) / 1000;
          if (d > MIN_MOVE_METERS && t > MIN_TIME_SEC) {
            rawSpeed = (d / t) * 3.6;
          }
        }

        smoothSpeed.current =
          smoothSpeed.current * (1 - SPEED_SMOOTHING) +
          rawSpeed * SPEED_SMOOTHING;

        if (smoothSpeed.current < STOP_SPEED) smoothSpeed.current = 0;
        setSpeed(Math.round(smoothSpeed.current));

        lastPos.current = newLoc;
        lastTime.current = now;
      },
      () => {},
      { enableHighAccuracy: true }
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [testerActive]);

  /* ================= ROUTE FETCH ================= */
  useEffect(() => {
    if (!isLoaded || !location || !destination) return;

    if (lastRouteOrigin.current) {
      const moved = distance(
        lastRouteOrigin.current.lat,
        lastRouteOrigin.current.lng,
        location.lat,
        location.lng
      );
      if (moved < 25) return;
    }

    const service = new window.google.maps.DirectionsService();
    service.route(
      {
        origin: location,
        destination,
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (res, status) => {
        if (status === "OK") {
          setDirections(res);
          lastRouteOrigin.current = location;

          const pts = [];
          res.routes[0].legs[0].steps.forEach((s) =>
            s.path.forEach((p) =>
              pts.push({ lat: p.lat(), lng: p.lng() })
            )
          );

          pathRef.current = pts;
          segIndex.current = 0;
          segProgress.current = 0;
        }
      }
    );
  }, [isLoaded, location, destination]);

  /* ================= TESTER MOVEMENT (FIXED) ================= */
 useEffect(() => {
  if (!testerActive || pathRef.current.length < 2) return;

  pausedAt.current = false;

  const tick = (t) => {
    if (!testerActive || pausedAt.current) return;

    if (!lastFrame.current) lastFrame.current = t;
    const dt = (t - lastFrame.current) / 1000;
    lastFrame.current = t;

    const speedMps =
      Math.max(testerSpeed, TESTER_MIN_SPEED) / 3.6;
    let move = speedMps * dt;

    while (move > 0 && segIndex.current < pathRef.current.length - 1) {
      const p1 = pathRef.current[segIndex.current];
      const p2 = pathRef.current[segIndex.current + 1];
      const segLen = distance(p1.lat, p1.lng, p2.lat, p2.lng);

      const remaining = segLen - segProgress.current;

      if (move < remaining) {
        segProgress.current += move;
        const r = segProgress.current / segLen;
        setLocation({
          lat: p1.lat + (p2.lat - p1.lat) * r,
          lng: p1.lng + (p2.lng - p1.lng) * r,
        });
        break;
      } else {
        move -= remaining;
        segIndex.current++;
        segProgress.current = 0;
        setLocation(p2);
      }
    }

    setSpeed(Math.round(testerSpeed));
    rafId.current = requestAnimationFrame(tick);
  };

  rafId.current = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(rafId.current);
}, [testerActive, testerSpeed]);

  /* ================= TURN SPEED ================= */
  useEffect(() => {
    if (!directions || !location) return;
    const steps = directions.routes[0].legs[0].steps;

    for (let s of steps) {
      if (!s.maneuver || s.path.length < 3) continue;

      const path = s.path;
      const p1 = { lat: path[0].lat(), lng: path[0].lng() };
      const p2 = {
        lat: path[Math.floor(path.length / 2)].lat(),
        lng: path[Math.floor(path.length / 2)].lng(),
      };
      const p3 = {
        lat: path[path.length - 1].lat(),
        lng: path[path.length - 1].lng(),
      };

      const dist = distance(location.lat, location.lng, p1.lat, p1.lng);
      if (dist < 5) continue;

      const angle = getTurnAngle(p1, p2, p3);
      const chord = distance(p1.lat, p1.lng, p3.lat, p3.lng);
      const radius = chord / (2 * Math.sin((angle * Math.PI) / 360));

      let maxSpeed = Math.min(getSafeTurnSpeed(radius), MAX_NORMAL_SPEED);
      if (dist < 300) maxSpeed = Math.min(maxSpeed, 25);
      else if (dist < 600) maxSpeed = Math.min(maxSpeed, 40);

      setTurnDistance(Math.round(dist));
      setMaxSafeSpeed(Math.round(maxSpeed));
      setIsOverspeedForTurn(speed > maxSpeed);
      break;
    }
  }, [directions, location, speed]);

  if (loadError) return <h2>Map load error</h2>;
  if (!isLoaded) return <h2>Loading…</h2>;

  return (
    <div className="test">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={FALLBACK_LOCATION}
        zoom={LOCKED_ZOOM}
        onLoad={(map) => {
          mapRef.current = map;
          map.setZoom(LOCKED_ZOOM);
          window.google.maps.event.addListenerOnce(map, "idle", () => {
            map.panTo(location);
            hasCenteredOnce.current = true;
          });
        }}
        options={{ disableDefaultUI: true, gestureHandling: "greedy" }}
      >
        <Marker position={location} />
        {destination && <Marker position={destination} />}
        {directions && (
          <DirectionsRenderer
            directions={directions}
            options={{ suppressMarkers: true, preserveViewport: true }}
          />
        )}
      </GoogleMap>

      <div className="speed"><h2>{speed} km/h</h2></div>

      <div
        className="turnDist"
        style={{ color: isOverspeedForTurn ? "#F44336" : "#4CAF50" }}
      >
        <h2>{turnDistance ? `${turnDistance} m` : "--"}</h2>
        <h3>Max Allowed Speed: {maxSafeSpeed ? `${maxSafeSpeed} km/h` : "--"}</h3>
      </div>

      <div className="dest">
        <input
          placeholder="Enter your Destination"
          value={destInput}
          onChange={(e) => setDestInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleGo()}
        />
        <button onClick={handleGo}>Go!</button>
      </div>

      <div className="me">
        <button onClick={handleMeClick}><h5>Me</h5></button>
      </div>

      {destination && (
        <div className="tester">
          <div className="btns">
            <h3>Speed</h3>
            <button onClick={() => setTesterSpeed(s => Math.min(s + 5, TESTER_MAX_SPEED))}>⬆️</button>
            <button onClick={() => setTesterSpeed(s => Math.max(s - 5, TESTER_MIN_SPEED))}>⬇️</button>
          </div>
          <div className="start">
            <button onClick={() => setTesterActive(true)}><h3>Start</h3></button>
            <button onClick={handleTesterStop}><h3>Stop</h3></button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= HELPERS ================= */
function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(p1, p2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const toDeg = (x) => (x * 180) / Math.PI;
  const dLon = toRad(p2.lng - p1.lng);
  const y = Math.sin(dLon) * Math.cos(toRad(p2.lat));
  const x =
    Math.cos(toRad(p1.lat)) * Math.sin(toRad(p2.lat)) -
    Math.sin(toRad(p1.lat)) *
      Math.cos(toRad(p2.lat)) *
      Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function getTurnAngle(p1, p2, p3) {
  let a = Math.abs(bearing(p2, p3) - bearing(p2, p1));
  return a > 180 ? 360 - a : a;
}

function getSafeTurnSpeed(radius) {
  return Math.sqrt(0.7 * 9.81 * radius) * 3.6;
}

//back