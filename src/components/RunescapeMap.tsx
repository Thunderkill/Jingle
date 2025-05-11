import L, { CRS, Icon } from 'leaflet';
import markerIconPng from 'leaflet/dist/images/marker-icon.png';
import 'leaflet/dist/leaflet.css';
import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
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

  useMapEvents({
    click: async (e) => {
      if (gameState.status !== GameStatus.Guessing) return;
      onMapClick(e.latlng);
    },
  });

  // pan to center of correct polygon
  useEffect(() => {
    if (gameState.status === GameStatus.AnswerRevealed && gameState.leaflet_ll_click) {
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
          setCursorPosition({ x: e.originalEvent.clientX, y: e.originalEvent.clientY });
        });

        layer.on('mouseout', () => {
          setSelectedSong(null);
          setCursorPosition(null);
        });

        layer.on('click', () => {
          if (songName !== null) {
            onFeatureClick?.(songName); // Call the new prop function
          }
        });
      }
    }
  };

  const getFeatureStyle = (feature: Feature) => {
    if (feature.properties && feature.properties.title) {
      const titleMatch = feature.properties.title.match(/>(.*?)</);
      if (titleMatch && titleMatch[1]) {
        const songName = decodeHTML(titleMatch[1]).trim();
        if (songName === selectedSong) {
          return {
            color: '#0d6efd', // Outline color
            fillColor: '#ff0000', // Highlight color (red)
            weight: 1, // Outline thickness
            fillOpacity: 0.5, // Opacity of fill
          };
        }
      }
    }
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
            fontSize: "20px"
          }}
        >
          {selectedSong}
        </div>
      )}
      {showGuessMarker && (
        <Marker
          position={gameState.leaflet_ll_click!}
          icon={
            new Icon({
              iconUrl: markerIconPng,
              iconSize: [25, 41],
              iconAnchor: [12, 41],
            })
          }
        />
      )}

      {geojsondata.features
        .filter((feature) => {
          // Extract song name from feature.properties.title
          if (feature.properties && feature.properties.title) {
            const titleMatch = feature.properties.title.match(/>(.*?)</);
            if (titleMatch && titleMatch[1]) {
              const songName = decodeHTML(titleMatch[1]).trim();
              // Check if the song name is in the allowed list
              return allowedSongNames.has(songName);
            }
          }
          return false; // Exclude features without valid properties or title
        })
        .map((feature, index) => {
          // Transform coordinates
          const transformedFeature: Feature = {
            ...feature,
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
                        return [leaflet_ll.lng, leaflet_ll.lat]; // Convert L.LatLng to [lng, lat]
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
                          return [leaflet_ll.lng, leaflet_ll.lat]; // Convert L.LatLng to [lng, lat]
                        })
                      )
                    )
                  : feature.geometry.coordinates, // Handle other geometry types if necessary
            },
          } as Feature; // Cast to Feature type

          return (
            <GeoJSON
              key={`${index}-${enabledRegions.join(',')}`}
              data={transformedFeature} // Use the transformed feature
              style={() => getFeatureStyle(transformedFeature)} // Use the getFeatureStyle function
              onEachFeature={handleEachFeature} // Pass the defined handler
            />
          );
        })}

      {gameState.status === GameStatus.AnswerRevealed && correctPolygon && (
        <GeoJSON
          data={correctPolygon as Feature}
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
