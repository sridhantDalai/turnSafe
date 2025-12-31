import './App.css';
import { Route , Routes} from "react-router-dom";
import Home from './components/home';
import Test from './components/test';

function App() {

  return (
    <div className="App">
      <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/test" element={<Test />} />
      </Routes>
    </div>
  );
}

export default App;
