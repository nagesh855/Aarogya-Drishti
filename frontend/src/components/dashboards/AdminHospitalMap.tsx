import { useEffect, useRef, useState, type FormEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation } from 'lucide-react';
import type { Hospital } from '../../../../shared/types/index.js';
import {
  LOCAL_HOSPITAL_PINS_STORAGE_KEY,
  readLocalHospitalPins,
  saveLocalHospitalPins,
  type LocalHospitalPin,
} from '../../utils/localHospitalPins.js';
import { SignatureCard } from '../ui/SignatureCard.js';

interface AdminHospitalMapProps {
  hospitals: Hospital[];
}

interface MapLocation {
  latitude: number;
  longitude: number;
}

interface HospitalPinDraft extends MapLocation {
  name: string;
  address: string;
  services: string;
}

export function AdminHospitalMap({ hospitals }: AdminHospitalMapProps) {
  const [localPins, setLocalPins] = useState<LocalHospitalPin[]>([]);
  const [draftLocation, setDraftLocation] = useState<MapLocation | null>(null);
  const [draft, setDraft] = useState<HospitalPinDraft | null>(null);
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const loadPins = () => {
      try {
        setLocalPins(readLocalHospitalPins());
      } catch (error) {
        setMapMessage(
          error instanceof Error ? error.message : 'Unable to load saved hospital map entries.'
        );
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_HOSPITAL_PINS_STORAGE_KEY) loadPins();
    };

    loadPins();
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [20.5937, 78.9629],
      zoom: 5,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    const markers = L.layerGroup().addTo(map);
    map.on('click', (event) => {
      const location = {
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      };
      setDraftLocation(location);
      setDraft({ ...location, name: '', address: '', services: '' });
      setMapMessage(null);
    });
    mapInstanceRef.current = map;
    markersLayerRef.current = markers;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const bounds: Array<[number, number]> = [];
    for (const hospital of hospitals) {
      const marker = L.circleMarker([hospital.latitude, hospital.longitude], {
        radius: 7,
        color: '#0D5C58',
        fillColor: '#0F766E',
        fillOpacity: 0.9,
        weight: 2,
        bubblingMouseEvents: false,
      });
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = hospital.name;
      const address = document.createElement('div');
      address.textContent = hospital.address;
      popup.append(title, address);
      marker.bindPopup(popup).addTo(layer);
      bounds.push([hospital.latitude, hospital.longitude]);
    }

    for (const pin of localPins) {
      const marker = L.circleMarker([pin.latitude, pin.longitude], {
        radius: 8,
        color: '#7C3AED',
        fillColor: '#A78BFA',
        fillOpacity: 0.95,
        weight: 2,
        bubblingMouseEvents: false,
      });
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = pin.name;
      const address = document.createElement('div');
      address.textContent = pin.address;
      popup.append(title, address);
      marker.bindPopup(popup).addTo(layer);
      bounds.push([pin.latitude, pin.longitude]);
    }

    if (draftLocation) {
      L.circleMarker([draftLocation.latitude, draftLocation.longitude], {
        radius: 9,
        color: '#B45309',
        fillColor: '#FBBF24',
        fillOpacity: 1,
        weight: 2,
        bubblingMouseEvents: false,
      })
        .bindPopup('New hospital location')
        .addTo(layer);
      bounds.push([draftLocation.latitude, draftLocation.longitude]);
    }

    if (bounds.length > 0 && !draftLocation) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
    }
  }, [hospitals, localPins, draftLocation]);

  const addCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMapMessage('Geolocation is not supported by this browser.');
      return;
    }
    setMapMessage('Requesting your current location...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setDraftLocation(location);
        setDraft({ ...location, name: '', address: '', services: '' });
        setMapMessage('Location found. Enter the hospital details to add this pin.');
        mapInstanceRef.current?.setView(
          [location.latitude, location.longitude],
          14
        );
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied. Allow location access and try again.'
            : 'Could not get your location. You can click the map to choose a location.';
        setMapMessage(message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const addHospitalPin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;

    const services = draft.services
      .split(',')
      .map((service) => service.trim())
      .filter(Boolean);
    if (!draft.name.trim() || !draft.address.trim()) {
      setMapMessage('Enter a hospital name and address.');
      return;
    }
    if (services.length === 0) {
      setMapMessage('Enter at least one hospital service.');
      return;
    }

    const pin: LocalHospitalPin = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: draft.name.trim(),
      address: draft.address.trim(),
      services,
      latitude: draft.latitude,
      longitude: draft.longitude,
      createdAt: new Date().toISOString(),
    };
    try {
      const updatedPins = [...localPins, pin];
      saveLocalHospitalPins(updatedPins);
      setLocalPins(updatedPins);
      setDraft(null);
      setDraftLocation(null);
      setMapMessage(`${pin.name} was added to this browser's hospital map.`);
    } catch (error) {
      setMapMessage(
        error instanceof Error ? error.message : 'Unable to save the hospital map entry.'
      );
    }
  };

  const pinCount = hospitals.length + localPins.length;

  return (
    <SignatureCard
      variant="navy"
      topRightBadge={`${pinCount} Pins`}
      icon={<MapPin className="h-6 w-6" />}
      pillLabel="Admin Hospital Map"
      title="Live Hospital Map"
      meta="Click the map to place a hospital pin. Added pins are saved in this browser."
      footer={{
        label: 'Map location',
        value: mapMessage || `${pinCount} hospitals and saved pins`,
        ctaLabel: 'Add My Current Location',
        onCtaClick: addCurrentLocation,
      }}
    >
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="relative overflow-hidden rounded-xl border border-slate-200 lg:col-span-7">
          <div ref={mapContainerRef} className="h-[420px] w-full" />
          {draft && (
            <form
              onSubmit={addHospitalPin}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              className="absolute left-3 top-3 z-[1000] max-h-[390px] w-[min(320px,calc(100%-24px))] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
            >
              <div>
                <h3 className="text-sm font-bold text-slate-900">Add Hospital Pin</h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  {draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)}
                </p>
              </div>
              <input
                required
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Hospital Name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <input
                required
                value={draft.address}
                onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                placeholder="Address"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <textarea
                required
                value={draft.services}
                onChange={(event) => setDraft({ ...draft, services: event.target.value })}
                placeholder="Services (comma-separated)"
                rows={3}
                className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setDraftLocation(null);
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Add Hospital
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="max-h-[420px] space-y-2 overflow-y-auto lg:col-span-5">
          {hospitals.map((hospital) => (
            <div key={hospital.id} className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-bold text-slate-900">{hospital.name}</p>
              <p className="mt-1 text-[11px] text-slate-600">{hospital.address}</p>
              <p className="mt-1 text-[10px] text-slate-500">
                {hospital.latitude.toFixed(4)}, {hospital.longitude.toFixed(4)}
              </p>
            </div>
          ))}
          {localPins.map((pin) => (
            <div key={pin.id} className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <p className="text-xs font-bold text-slate-900">{pin.name}</p>
              <p className="mt-1 text-[11px] text-slate-600">{pin.address}</p>
              <p className="mt-1 text-[10px] text-slate-600">{pin.services.join(', ')}</p>
              <p className="mt-1 text-[10px] text-slate-500">
                {pin.latitude.toFixed(4)}, {pin.longitude.toFixed(4)}
              </p>
            </div>
          ))}
          {pinCount === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
              No hospital locations to display.
            </p>
          )}
        </div>
      </div>
      {mapMessage && (
        <p role="status" className="mt-3 text-xs text-slate-600">
          {mapMessage}
        </p>
      )}
      <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-slate-500">
        <Navigation className="h-3 w-3" />
        Browser localStorage is per device; these pins are not shared with other users.
      </p>
    </SignatureCard>
  );
}
