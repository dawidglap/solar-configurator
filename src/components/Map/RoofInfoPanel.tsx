export default function RoofInfoPanel({ data }: { data: any }) {
  if (!data) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-white p-4 rounded-lg shadow-lg z-[1000] max-w-xs">
      <h2 className="font-semibold text-lg mb-2">🌞 Info Tetto</h2>
      <p><strong>Classe:</strong> {data.klasse_text}</p>
      <p><strong>Superficie:</strong> {data.flaeche?.toFixed(1)} m²</p>
      <p><strong>Inclinazione:</strong> {data.neigung}°</p>
      <p><strong>Orientamento:</strong> {data.ausrichtung}°</p>
      <p><strong>Produzione:</strong> {data.stromertrag} kWh</p>
      <p><strong>Valore:</strong> {data.finanzertrag} CHF</p>
    </div>
  );
}
