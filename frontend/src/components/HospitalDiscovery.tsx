import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Building2,
  Calendar,
  ExternalLink,
  MapPin,
  Navigation,
  Phone,
  Search,
  ShieldAlert,
  Star,
  Stethoscope,
  Video,
} from 'lucide-react';
import { apiRequest } from '../utils/api.js';
import {
  LOCAL_HOSPITAL_PINS_STORAGE_KEY,
  readLocalHospitalPins,
  type LocalHospitalPin,
} from '../utils/localHospitalPins.js';
import { getWorkingStatusLabel } from '../utils/workingStatusLabel.js';
import { SignatureCard, getVariantByIndex } from './ui/SignatureCard.js';

export interface DiscoveredDoctor {
  id: string;
  doctorCode: string;
  hospitalId: string;
  fullName: string;
  qualifications: string;
  registrationNumber: string;
  specialization: string;
  yearsOfExperience: number;
  areasOfExpertise: string[];
  consultationFee: number;
  onlineConsultationAvailable: boolean;
  inPersonConsultationAvailable: boolean;
  workingStatus: 'available' | 'busy' | 'on_leave';
  verificationStatus: 'pending' | 'verified' | 'rejected';
}

export interface DiscoveredHospital {
  id: string;
  hospitalCode: string;
  name: string;
  registrationNumber: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  phone: string;
  email: string;
  facilities: string[];
  services: string[];
  workingHours: string;
  distanceKm: number | null;
  doctors: DiscoveredDoctor[];
  isLocalPin?: boolean;
}

interface HospitalDiscoveryProps {
  onBookAppointment: (hospital: DiscoveredHospital, doctor: DiscoveredDoctor) => void;
  onRequestUrgent: (hospital: DiscoveredHospital, doctor?: DiscoveredDoctor) => void;
}

export function HospitalDiscovery({
  onBookAppointment,
  onRequestUrgent,
}: HospitalDiscoveryProps) {
  const [apiHospitals, setApiHospitals] = useState<DiscoveredHospital[]>([]);
  const [localPins, setLocalPins] = useState<LocalHospitalPin[]>([]);
  const [localPinsError, setLocalPinsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [specializationFilter, setSpecializationFilter] = useState('');
  const [minExpFilter, setMinExpFilter] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'list'>('split');
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  const hospitals = useMemo<DiscoveredHospital[]>(
    () => [
      ...apiHospitals,
      ...localPins.map((pin) => ({
        id: `local-pin-${pin.id}`,
        hospitalCode: pin.id,
        name: pin.name,
        registrationNumber: '',
        address: pin.address,
        city: '',
        state: '',
        pincode: '',
        latitude: pin.latitude,
        longitude: pin.longitude,
        phone: '',
        email: '',
        facilities: pin.services,
        services: pin.services,
        workingHours: 'Admin-added map pin',
        distanceKm: null,
        doctors: [],
        isLocalPin: true,
      })),
    ],
    [apiHospitals, localPins]
  );

  const fetchHospitals = async (coords?: { lat: number; lng: number } | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (cityFilter.trim()) params.set('city', cityFilter.trim());
      if (specializationFilter.trim()) params.set('specialization', specializationFilter.trim());
      if (minExpFilter) params.set('minExperience', minExpFilter);
      if (onlineOnly) params.set('onlineOnly', 'true');
      if (availableOnly) params.set('availableOnly', 'true');
      const activeCoords = coords ?? userCoords;
      if (activeCoords) {
        params.set('lat', String(activeCoords.lat));
        params.set('lng', String(activeCoords.lng));
      }
      const res = await apiRequest<{ hospitals: DiscoveredHospital[] }>(
        `/api/patient/discover?${params.toString()}`
      );
      setApiHospitals(res.hospitals || []);
    } catch {
      setApiHospitals([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadLocalPins = () => {
      try {
        setLocalPins(readLocalHospitalPins());
        setLocalPinsError(null);
      } catch (error) {
        setLocalPinsError(
          error instanceof Error ? error.message : 'Unable to load saved hospital map entries.'
        );
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== LOCAL_HOSPITAL_PINS_STORAGE_KEY) return;
      loadLocalPins();
    };

    loadLocalPins();
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    void fetchHospitals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineOnly, availableOnly]);

  // Initialize Leaflet map
  useEffect(() => {
    if (viewMode !== 'split' || !mapContainerRef.current) return;
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [20.5937, 78.9629],
        zoom: 5,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
      }
    };
  }, [viewMode]);

  // Update map markers when hospitals or userCoords change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const bounds: Array<[number, number]> = [];

    if (userCoords) {
      const userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
        radius: 8,
        color: '#0D5C58',
        fillColor: '#2DD4BF',
        fillOpacity: 0.9,
        weight: 2,
      }).bindPopup('Your Current Location');
      userMarker.addTo(layer);
      bounds.push([userCoords.lat, userCoords.lng]);
    }

    for (const h of hospitals) {
      const isSelected = h.id === selectedHospitalId;
      const marker = L.circleMarker([h.latitude, h.longitude], {
        radius: isSelected ? 11 : 8,
        color: isSelected ? '#0A192F' : '#0D5C58',
        fillColor: isSelected ? '#0D5C58' : '#164E63',
        fillOpacity: 0.95,
        weight: isSelected ? 3 : 2,
      });

      const popup = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = h.name;
      const address = document.createElement('div');
      address.textContent = [h.address, h.city].filter(Boolean).join(', ');
      const doctorCount = document.createElement('div');
      doctorCount.textContent = h.isLocalPin
        ? 'Admin-added map pin'
        : `${h.doctors.length} registered doctor(s)`;
      popup.append(name, address, doctorCount);
      marker.bindPopup(popup);
      marker.on('click', () => setSelectedHospitalId(h.id));
      marker.addTo(layer);
      bounds.push([h.latitude, h.longitude]);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  }, [hospitals, userCoords, selectedHospitalId]);

  const requestDeviceLocation = () => {
    if (!navigator.geolocation) {
      setGeoStatus('Geolocation is not supported by your browser. Use manual city search.');
      return;
    }
    setGeoStatus('Requesting location permission...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserCoords(coords);
        setGeoStatus('Location enabled — hospitals sorted by distance.');
        void fetchHospitals(coords);
      },
      () => {
        setGeoStatus('Location permission declined. You can search manually by city or area.');
      }
    );
  };

  const totalVerifiedDocs = hospitals.reduce(
    (acc, h) => acc + h.doctors.filter((d) => d.verificationStatus === 'verified').length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Search & Filters (Signature 2-Part Gradient Card) */}
      <SignatureCard
        variant="teal"
        topRightBadge={`${hospitals.length} Facilities`}
        icon={<Search className="w-6 h-6" />}
        pillLabel="Hospital & Specialist Finder"
        title="Find Registered Hospitals & Verified Oral Specialists"
        meta={
          <>
            <MapPin className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
            <span>Filter by city, specialization, experience, video consult availability, or distance</span>
          </>
        }
        metrics={[
          { icon: <Building2 className="w-3.5 h-3.5" />, value: hospitals.length, label: 'Hospitals' },
          { icon: <Stethoscope className="w-3.5 h-3.5" />, value: totalVerifiedDocs, label: 'Verified Docs' },
          { icon: <Video className="w-3.5 h-3.5" />, value: viewMode === 'split' ? 'Map+List' : 'List', label: 'View Mode' },
        ]}
        footer={{
          label: 'Discovery status',
          value: geoStatus || 'All verified hospitals ready for booking',
          ctaLabel: 'Use My Location',
          onCtaClick: requestDeviceLocation,
        }}
      >
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void fetchHospitals()}
                placeholder="Search hospital name, area, service, or doctor..."
                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0D5C58]"
              />
            </div>

            <input
              type="text"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void fetchHospitals()}
              placeholder="City (e.g. Bengaluru, Mumbai)"
              className="lg:w-56 px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0D5C58]"
            />

            <button
              type="button"
              onClick={() => void fetchHospitals()}
              className="ad-btn-teal px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              Search
            </button>

            <button
              type="button"
              onClick={requestDeviceLocation}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0D5C58] bg-[#ECFDF5] border border-emerald-200 hover:bg-emerald-100/70 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5" />
              Locate Me
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-gray-100">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={specializationFilter}
                onChange={(e) => setSpecializationFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-xl bg-white"
              >
                <option value="">All Specializations</option>
                <option value="Oral Medicine">Oral Medicine</option>
                <option value="Oncology">Head &amp; Neck Oncology</option>
                <option value="Maxillofacial">Maxillofacial Surgery</option>
                <option value="ENT">ENT &amp; Oral Cavity</option>
              </select>

              <select
                value={minExpFilter}
                onChange={(e) => setMinExpFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-xl bg-white"
              >
                <option value="">Any Experience</option>
                <option value="5">5+ Years Experience</option>
                <option value="10">10+ Years Experience</option>
                <option value="15">15+ Years Experience</option>
              </select>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlineOnly}
                  onChange={(e) => setOnlineOnly(e.target.checked)}
                  className="rounded border-gray-300 text-[#0D5C58] focus:ring-[#0D5C58]"
                />
                Video Consultation Available
              </label>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                  className="rounded border-gray-300 text-[#0D5C58] focus:ring-[#0D5C58]"
                />
                Available Status Only
              </label>
            </div>

            <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-full border border-gray-200">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`px-3.5 py-1 text-xs font-semibold rounded-full cursor-pointer transition-colors ${
                  viewMode === 'split'
                    ? 'bg-[#0D5C58] text-white shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Map &amp; List
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-3.5 py-1 text-xs font-semibold rounded-full cursor-pointer transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#0D5C58] text-white shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                List Only
              </button>
            </div>
          </div>
        </div>
      </SignatureCard>

      {/* Results Area */}
      {localPinsError && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {localPinsError}
        </p>
      )}
      <div className={viewMode === 'split' ? 'grid lg:grid-cols-12 gap-6 items-start' : ''}>
        {viewMode === 'split' && (
          <div className="lg:col-span-5 sticky top-20">
            <SignatureCard
              variant="navy"
              topRightBadge={`${hospitals.length} Pins`}
              icon={<MapPin className="w-6 h-6" />}
              pillLabel="Interactive Network Map"
              title="Live Hospital Map"
              meta="Select any pin to highlight clinic details"
              footer={{
                label: 'Map synced',
                value: `${hospitals.length} registered hospitals`,
                ctaLabel: 'Refresh',
                onCtaClick: () => void fetchHospitals(),
              }}
            >
              <div className="rounded-2xl overflow-hidden border border-gray-200">
                <div ref={mapContainerRef} className="w-full h-[420px] z-10" />
              </div>
            </SignatureCard>
          </div>
        )}

        <div className={viewMode === 'split' ? 'lg:col-span-7 space-y-6' : 'grid md:grid-cols-2 gap-6'}>
          {loading ? (
            <SignatureCard
              variant="teal"
              icon={<Building2 className="w-6 h-6" />}
              pillLabel="Searching Network"
              title="Loading registered hospitals..."
              meta="Fetching verified specialists and availability slots"
            />
          ) : hospitals.length === 0 ? (
            <SignatureCard
              variant="saffron"
              icon={<Search className="w-6 h-6" />}
              pillLabel="No Results"
              title="No matching hospitals or doctors found"
              meta="Try clearing city or specialization filters to inspect all registered facilities."
              footer={{
                label: 'Reset filters',
                value: 'Show all registered centers',
                dotTone: 'amber',
                ctaLabel: 'Show All',
                onCtaClick: () => {
                  setSearchQuery('');
                  setCityFilter('');
                  setSpecializationFilter('');
                  setMinExpFilter('');
                  setOnlineOnly(false);
                  setAvailableOnly(false);
                  void fetchHospitals();
                },
              }}
            />
          ) : (
            hospitals.map((hospital, idx) => {
              const verifiedCount = hospital.doctors.filter(
                (d) => d.verificationStatus === 'verified'
              ).length;
              const minFee =
                hospital.doctors.length > 0
                  ? Math.min(...hospital.doctors.map((d) => d.consultationFee))
                  : 500;
              const hasOnline = hospital.doctors.some((d) => d.onlineConsultationAvailable);

              return (
                <SignatureCard
                  key={hospital.id}
                  variant={getVariantByIndex(idx)}
                  highlighted={selectedHospitalId === hospital.id}
                  onClick={() => setSelectedHospitalId(hospital.id)}
                  topRightBadge={
                    hospital.isLocalPin ? (
                      <span>Map Pin</span>
                    ) : hospital.distanceKm !== null ? (
                      <span>{hospital.distanceKm} km away</span>
                    ) : (
                      <>
                        <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                        <span>4.9</span>
                      </>
                    )
                  }
                  icon={<Building2 className="w-6 h-6" />}
                  pillLabel={hospital.isLocalPin ? 'Admin-added map pin' : 'Verified Hospital'}
                  title={hospital.name}
                  meta={
                    <>
                      <MapPin className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
                      <span>
                        {[
                          hospital.address,
                          hospital.city,
                          hospital.state,
                          hospital.pincode,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </>
                  }
                  tags={hospital.services.slice(0, 4)}
                  metrics={[
                    {
                      icon: <Stethoscope className="w-3.5 h-3.5" />,
                      value: hospital.isLocalPin
                        ? '—'
                        : `${verifiedCount || hospital.doctors.length}`,
                      label: hospital.isLocalPin ? 'Registered Docs' : 'Verified Docs',
                    },
                    {
                      icon: <Video className="w-3.5 h-3.5" />,
                      value: hospital.isLocalPin ? '—' : hasOnline ? 'Video+OPD' : 'OPD Only',
                      label: 'Consult Mode',
                    },
                    {
                      value: hospital.isLocalPin ? '—' : `₹${minFee}+`,
                      label: 'Starting Fee',
                    },
                  ]}
                  footer={{
                    label: 'Next available',
                    value: hospital.workingHours,
                    rightSlot: (
                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={`https://www.openstreetmap.org/directions?to=${hospital.latitude},${hospital.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl whitespace-nowrap"
                        >
                          Map
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {!hospital.isLocalPin && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRequestUrgent(hospital);
                            }}
                            className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold text-white bg-gradient-to-br from-rose-600 to-red-700 rounded-xl whitespace-nowrap cursor-pointer shadow-xs"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            Urgent
                          </button>
                        )}
                      </div>
                    ),
                  }}
                >
                  {hospital.isLocalPin ? (
                    <p className="text-xs text-slate-500">
                      This locally saved pin is not yet a registered booking facility.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3 text-[#0D5C58]" /> {hospital.phone}
                      </span>
                      <span>·</span>
                      <span className="font-mono">Reg: {hospital.registrationNumber}</span>
                    </div>
                  )}

                  {/* Doctors under this hospital (Zero Photographs — Clean Initials Badges) */}
                  <div className="space-y-2.5 pt-2 border-t border-gray-100">
                    {hospital.doctors.map((doc) => {
                      const isVerified = doc.verificationStatus === 'verified';
                      const initials =
                        doc.fullName
                          .replace(/^Dr\.?\s+/i, '')
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join('')
                          .toUpperCase() || 'DR';
                      return (
                        <div
                          key={doc.id}
                          className="p-3.5 rounded-2xl border border-gray-200/80 bg-[#FBFBFA] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-11 h-11 rounded-2xl bg-[#ECFDF5] border border-emerald-200 flex items-center justify-center text-xs font-bold text-[#0D5C58] shrink-0 font-display">
                              {initials}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-bold text-gray-900">{doc.fullName}</p>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    isVerified
                                      ? 'bg-[#ECFDF5] text-[#0D5C58]'
                                      : 'bg-amber-50 text-[#EA580C]'
                                  }`}
                                >
                                  {isVerified ? 'Verified' : 'Pending'}
                                </span>
                              </div>
                              <p className="text-xs text-gray-600 mt-0.5">
                                {doc.qualifications} · {doc.specialization}
                              </p>
                              <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
                                {doc.yearsOfExperience} yrs exp · Fee ₹{doc.consultationFee} ·{' '}
                                <span className="capitalize">
                                  {getWorkingStatusLabel(doc.workingStatus)}
                                </span>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={doc.workingStatus === 'on_leave'}
                              onClick={(e) => {
                                e.stopPropagation();
                                onBookAppointment(hospital, doc);
                              }}
                              className="ad-btn-teal inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 rounded-xl whitespace-nowrap cursor-pointer transition-all"
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              {doc.workingStatus === 'on_leave' ? 'Inactive' : 'Book'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SignatureCard>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
