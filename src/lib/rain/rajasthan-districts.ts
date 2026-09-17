export interface RajasthanDistrict {
  district: string;
  latitude: number;
  longitude: number;
}

// Representative district-headquarter coordinates used only for the public
// forecast layer. They are not evidence of rain at every point in a district.
export const RAJASTHAN_DISTRICTS: RajasthanDistrict[] = [
  { district: "Ajmer", latitude: 26.4499, longitude: 74.6399 },
  { district: "Alwar", latitude: 27.553, longitude: 76.6346 },
  { district: "Balotara", latitude: 25.8326, longitude: 72.24 },
  { district: "Banswara", latitude: 23.5461, longitude: 74.4349 },
  { district: "Baran", latitude: 25.1011, longitude: 76.5132 },
  { district: "Barmer", latitude: 25.7532, longitude: 71.4181 },
  { district: "Beawar", latitude: 26.1007, longitude: 74.3191 },
  { district: "Bharatpur", latitude: 27.217, longitude: 77.4895 },
  { district: "Bhilwara", latitude: 25.3407, longitude: 74.6313 },
  { district: "Bikaner", latitude: 28.0229, longitude: 73.3119 },
  { district: "Bundi", latitude: 25.4386, longitude: 75.6377 },
  { district: "Chittorgarh", latitude: 24.8887, longitude: 74.6269 },
  { district: "Churu", latitude: 28.292, longitude: 74.9618 },
  { district: "Dausa", latitude: 26.8932, longitude: 76.3375 },
  { district: "Deeg", latitude: 27.4729, longitude: 77.328 },
  { district: "Dholpur", latitude: 26.7025, longitude: 77.8934 },
  { district: "Didwana-Kuchaman", latitude: 27.402, longitude: 74.575 },
  { district: "Dungarpur", latitude: 23.8431, longitude: 73.7147 },
  { district: "Hanumangarh", latitude: 29.5818, longitude: 74.3294 },
  { district: "Jaipur", latitude: 26.9124, longitude: 75.7873 },
  { district: "Jaisalmer", latitude: 26.9157, longitude: 70.9083 },
  { district: "Jalore", latitude: 25.3456, longitude: 72.6204 },
  { district: "Jhalawar", latitude: 24.5973, longitude: 76.1609 },
  { district: "Jhunjhunu", latitude: 28.1289, longitude: 75.3997 },
  { district: "Jodhpur", latitude: 26.2389, longitude: 73.0243 },
  { district: "Karauli", latitude: 26.498, longitude: 77.0151 },
  { district: "Khairthal-Tijara", latitude: 27.8228, longitude: 76.789 },
  { district: "Kota", latitude: 25.2138, longitude: 75.8648 },
  { district: "Kotputli-Behror", latitude: 27.4274, longitude: 76.135 },
  { district: "Nagaur", latitude: 27.1991, longitude: 73.7409 },
  { district: "Pali", latitude: 25.7711, longitude: 73.3234 },
  { district: "Phalodi", latitude: 27.131, longitude: 72.3683 },
  { district: "Pratapgarh", latitude: 24.0322, longitude: 74.7819 },
  { district: "Rajsamand", latitude: 25.0715, longitude: 73.8798 },
  { district: "Salumbar", latitude: 24.1356, longitude: 74.825 },
  { district: "Sawai Madhopur", latitude: 26.0378, longitude: 76.3522 },
  { district: "Sikar", latitude: 27.6094, longitude: 75.1399 },
  { district: "Sirohi", latitude: 24.885, longitude: 72.857 },
  { district: "Sri Ganganagar", latitude: 29.9038, longitude: 73.8772 },
  { district: "Tonk", latitude: 26.1664, longitude: 75.7882 },
  { district: "Udaipur", latitude: 24.5854, longitude: 73.7125 },
];
