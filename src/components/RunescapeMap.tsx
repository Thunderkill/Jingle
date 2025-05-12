import L, { CRS, Icon, Point } from 'leaflet'; // Import Point
import markerIconPng from 'leaflet/dist/images/marker-icon.png';
import 'leaflet/dist/leaflet.css';
import { RefObject, useEffect, useMemo, useRef, useState } from 'react'; // Import useRef
import { Feature } from 'geojson'; // Import Feature
import {
  GeoJSON,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { GameState, GameStatus } from '../types/jingle';
import {
  findNearestPolygonWhereSongPlays,
  getCenterOfPolygon,
  leaflet_ll_to_leaflet_xy,
  leaflet_xy_to_leaflet_ll,
  geojson_xy_to_leaflet_xy,
} from '../utils/map-utils';
import { decodeHTML } from '../utils/string-utils'; // Import decodeHTML
import geojsondata from '../data/GeoJSON';

const outerBounds = new L.LatLngBounds(L.latLng(-78, 0), L.latLng(0, 136.696));

import { Region, REGIONS } from '../constants/regions'; // Import Region and REGIONS

interface RunescapeMapProps {
  gameState: GameState;
  onMapClick: (leaflet_ll_click: L.LatLng) => void;
  onFeatureClick?: (songName: string) => void; // Add the new prop
  enabledRegions: Region[]; // Add enabledRegions prop
}

export default function RunescapeMapWrapper({
  mapRef,
  ...props
}: RunescapeMapProps & { mapRef: RefObject<L.Map | null> }) {
  return (
    <MapContainer
      ref={mapRef}
      center={[-35, 92.73]}
      zoom={5}
      maxZoom={6}
      minZoom={4}
      style={{ height: '100dvh', width: '100%' }}
      maxBounds={outerBounds}
      maxBoundsViscosity={1}
      crs={CRS.Simple}
    >
      <RunescapeMap {...props} />
      <TileLayer attribution='offline' url={`/rsmap-tiles/{z}/{x}/{y}.png`} />
    </MapContainer>
  );
}

function RunescapeMap({
  gameState,
  onMapClick,
  onFeatureClick,
  enabledRegions,
}: RunescapeMapProps) {
  const map = useMap();
  const [selectedSong, setSelectedSong] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [overlappingSongs, setOverlappingSongs] = useState<string[]>([]);
  const [overlapListPosition, setOverlapListPosition] = useState<Point | null>(
    null
  );
  const overlapListRef = useRef<HTMLDivElement>(null); // Ref for the overlap list

  // Create a set of allowed song names based on enabled regions
  const allowedSongNames = useMemo(() => {
    const songNames = new Set<string>();
    enabledRegions.forEach((region) => {
      if (REGIONS[region]) {
        REGIONS[region].forEach((songName) => {
          songNames.add(songName);
        });
      }
    });
    return songNames;
  }, [enabledRegions]);

  const transformedAndFilteredFeatures = useMemo(() => {
    if (!map) return [];
    return geojsondata.features
      .filter((feature) => {
        if (feature.properties && feature.properties.title) {
          const titleMatch = feature.properties.title.match(/>(.*?)</);
          if (titleMatch && titleMatch[1]) {
            const songName = decodeHTML(titleMatch[1]).trim();
            return allowedSongNames.has(songName);
          }
        }
        return false;
      })
      .map((feature) => {
        let songName = '';
        // More explicit check for properties and title
        if (feature.properties?.title) {
          const titleMatch = feature.properties.title.match(/>(.*?)</);
          if (titleMatch?.[1]) {
            // Optional chaining for match result
            songName = decodeHTML(titleMatch[1]).trim();
          }
        }
        return {
          ...feature,
          properties: {
            ...feature.properties,
            songName: songName, // Store songName directly
          },
          geometry: {
            ...feature.geometry,
            coordinates:
              feature.geometry.type === 'Polygon'
                ? feature.geometry.coordinates.map((ring) =>
                    ring.map(([x, y]) => {
                      const leaflet_xy = geojson_xy_to_leaflet_xy([x, y]);
                      const leaflet_ll = leaflet_xy_to_leaflet_ll(
                        map,
                        leaflet_xy
                      );
                      return [leaflet_ll.lng, leaflet_ll.lat];
                    })
                  )
                : feature.geometry.type === 'MultiPolygon'
                ? (
                    feature.geometry.coordinates as unknown as Array<
                      Array<Array<[number, number]>>
                    >
                  ).map((polygon) =>
                    polygon.map((ring) =>
                      ring.map(([x, y]) => {
                        const leaflet_xy = geojson_xy_to_leaflet_xy([x, y]);
                        const leaflet_ll = leaflet_xy_to_leaflet_ll(
                          map,
                          leaflet_xy
                        );
                        return [leaflet_ll.lng, leaflet_ll.lat];
                      })
                    )
                  )
                : feature.geometry.coordinates,
          },
        } as Feature & { properties: { songName: string } }; // Ensure songName is in type
      });
  }, [map, allowedSongNames]);

  // Helper function for point-in-polygon check (Ray Casting Algorithm)
  const isPointInPolygon = (
    point: L.LatLng,
    polygonCoordinates: number[][][]
  ): boolean => {
    const x = point.lng;
    const y = point.lat;
    let isInside = false;

    for (const ring of polygonCoordinates) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];

        const intersect =
          yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) isInside = !isInside;
      }
    }
    return isInside;
  };
  const isPointInMultiPolygon = (
    point: L.LatLng,
    multiPolygonCoordinates: number[][][][]
  ): boolean => {
    for (const polygon of multiPolygonCoordinates) {
      if (isPointInPolygon(point, polygon)) {
        return true;
      }
    }
    return false;
  };

  useMapEvents({
    click: async (e) => {
      // Check if the click originated inside the overlap list
      if (
        overlapListRef.current &&
        overlapListRef.current.contains(e.originalEvent.target as Node)
      ) {
        console.log('Click inside overlap list, ignoring map click.');
        return; // Don't process map click if it's on the list
      }

      console.log('Handling map click');
      setOverlappingSongs([]); // Close list on any map click outside the list
      setOverlapListPosition(null);

      const clickedLatLng = e.latlng;
      const featuresAtClick: string[] = [];

      transformedAndFilteredFeatures.forEach((feature) => {
        if (feature.geometry.type === 'Polygon') {
          if (
            isPointInPolygon(
              clickedLatLng,
              feature.geometry.coordinates as number[][][]
            )
          ) {
            featuresAtClick.push(feature.properties.songName);
          }
        } else if (feature.geometry.type === 'MultiPolygon') {
          if (
            isPointInMultiPolygon(
              clickedLatLng,
              feature.geometry.coordinates as number[][][][]
            )
          ) {
            featuresAtClick.push(feature.properties.songName);
          }
        }
      });

      if (featuresAtClick.length > 1) {
        setOverlappingSongs(featuresAtClick);
        setOverlapListPosition(e.containerPoint);
      } else if (featuresAtClick.length === 1) {
        if (onFeatureClick) {
          onFeatureClick(featuresAtClick[0]);
        } else if (gameState.status === GameStatus.Guessing) {
          onMapClick(clickedLatLng);
        }
      } else {
        if (gameState.status === GameStatus.Guessing) {
          onMapClick(clickedLatLng);
        }
      }
    },
  });

  // pan to center of correct polygon
  useEffect(() => {
    if (
      gameState.status === GameStatus.AnswerRevealed &&
      gameState.leaflet_ll_click
    ) {
      const song = gameState.songs[gameState.round];
      const { polygon } = findNearestPolygonWhereSongPlays(
        map,
        song,
        gameState.leaflet_ll_click as L.LatLng
      );

      const leaflet_ll_correctPolygon = polygon.geometry.coordinates[0];
      const leaflet_xy_correctPolygon = leaflet_ll_correctPolygon
        .map(([lng, lat]) => new L.LatLng(lat, lng))
        .map((ll) => leaflet_ll_to_leaflet_xy(map, ll));
      const leaflet_xy_centerOfCorrectPolygon = getCenterOfPolygon(
        leaflet_xy_correctPolygon
      );
      const leaflet_ll_centerOfCorrectPolygon = leaflet_xy_to_leaflet_ll(
        map,
        leaflet_xy_centerOfCorrectPolygon
      );
      map.panTo(leaflet_ll_centerOfCorrectPolygon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, gameState.status]);

  const showGuessMarker =
    (gameState.status === GameStatus.Guessing && gameState.leaflet_ll_click) ||
    gameState.status === GameStatus.AnswerRevealed;

  const song = gameState.songs[gameState.round];
  const leaflet_ll_click = gameState.leaflet_ll_click;
  const correctPolygon = useMemo(() => {
    if (!map || !song || !leaflet_ll_click) return undefined;

    const { polygon } = findNearestPolygonWhereSongPlays(
      map,
      song,
      leaflet_ll_click as L.LatLng
    );
    return polygon;
  }, [map, song, leaflet_ll_click]);

  const handleEachFeature = (feature: Feature, layer: L.Layer) => {
    if (feature.properties && feature.properties.title) {
      const titleMatch = feature.properties.title.match(/>(.*?)</);
      if (titleMatch && titleMatch[1]) {
        const songName = decodeHTML(titleMatch[1]).trim();

        layer.on('mouseover', (e) => {
          setSelectedSong(songName);
          setCursorPosition({
            x: e.originalEvent.clientX,
            y: e.originalEvent.clientY,
          });
        });

        layer.on('mouseout', () => {
          setSelectedSong(null);
          setCursorPosition(null);
        });

        // Click handling is now done by useMapEvents
      }
    }
  };

  const getFeatureStyle = (feature: Feature) => {
    if (feature.properties && (feature.properties as any).songName) {
      // Use stored songName
      const songName = (feature.properties as any).songName;
      if (songName === selectedSong) {
        return {
          color: '#0d6efd', // Outline color
          fillColor: '#ff0000', // Highlight color (red)
          weight: 1, // Outline thickness
          fillOpacity: 0.5, // Opacity of fill
        };
      }
    }
    // Removed extra closing brace here
    return {
      color: '#0d6efd', // Outline color
      fillColor: '#0d6efd', // Default fill color
      weight: 1, // Outline thickness
      fillOpacity: 0.2, // Opacity of fill
    };
  };

  return (
    <>
      {selectedSong && cursorPosition && (
        <div
          style={{
            position: 'fixed', // Use fixed to position relative to the viewport
            top: cursorPosition.y + 10, // Add offset to avoid covering the cursor
            left: cursorPosition.x + 10, // Add offset
            zIndex: 1000,
            backgroundColor: 'rgba(0, 0, 0, 0.7)', // Slightly darker background
            color: 'white',
            padding: '6px', // Increased padding
            borderRadius: '5px',
            pointerEvents: 'none', // Prevent cursor interaction
            fontSize: '20px',
          }}
        >
          {selectedSong}
        </div>
      )}
      {overlappingSongs.length > 0 && overlapListPosition && (
        <div
          style={{
            position: 'absolute',
            top: overlapListPosition.y,
            left: overlapListPosition.x,
            zIndex: 1001, // Above the song title tooltip
            backgroundColor: 'rgba(50, 50, 50, 0.9)',
            color: 'white',
            padding: '10px',
            borderRadius: '5px',
            border: '1px solid #ccc',
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
          }}
          ref={overlapListRef} // Assign the ref here
        >
          <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>
            Select a song:
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {overlappingSongs.map((songName) => (
              <li
                key={songName}
                onClick={() => { // No need for evt or stopPropagation here anymore
                  console.log('Clicking on %s', songName);
                  if (onFeatureClick) {
                    onFeatureClick(songName);
                  }
                  setOverlappingSongs([]);
                  setOverlapListPosition(null);
                }}
                style={{
                  padding: '5px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #444',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = '#555')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = 'transparent')
                }
              >
                {songName}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showGuessMarker && gameState.leaflet_ll_click && (
        <Marker
          position={gameState.leaflet_ll_click}
          icon={
            new Icon({
              iconUrl: markerIconPng,
              iconSize: [25, 41],
              iconAnchor: [12, 41],
            })
          }
        />
      )}

      {transformedAndFilteredFeatures.map((feature, index) => {
        // Add key check for properties.songName existence if needed, though it should exist here
        const keySuffix = feature.properties?.songName || `feature-${index}`;
        return (
          <GeoJSON
            key={`${index}-${enabledRegions.join(',')}-${keySuffix}`}
            data={feature}
            style={() => getFeatureStyle(feature)}
            onEachFeature={handleEachFeature}
          />
        );
      })}

      {gameState.status === GameStatus.AnswerRevealed &&
        correctPolygon && ( // Explicit check already here, but reinforcing
          <GeoJSON
            data={correctPolygon as Feature} // Keep assertion if confident, or add check
            style={() => ({
              color: '#0d6efd', // Outline color
              fillColor: '#0d6efd', // Fill color
              weight: 5, // Outline thickness
              fillOpacity: 0.5, // Opacity of fill
              transition: 'all 2000ms',
            })}
          />
        )}
      <TileLayer attribution='offline' url={`/rsmap-tiles/{z}/{x}/{y}.png`} />
    </>
  );
}
