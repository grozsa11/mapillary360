//
// Mapillary 360 teszt - első API kapcsolat
//

const status = document.getElementById("status");


// IDE MÁSOLD BE A SAJÁT MAPILLARY TOKENEDET TESZTHEZ
const ACCESS_TOKEN = "MLY|27807182582227312|79dfc40dcd393eea90d9dae310bd0025";


// Tesztpont környéke:
// 47.62788, 19.03806
//
// Ennél a tesztnél egyetlen z14 csempét kérünk le.


async function testMapillary()
{
    status.textContent =
        "Mapillary kapcsolat teszt indul...\n";


    //
    // A tesztpont XYZ csempéje:
    //
    // z=14
    // x=9059
    // y=5727
    //
    // (ezt a böngésző Network adataiból már tudjuk)
    //

    const url =
        "https://tiles.mapillary.com/maps/vtp/mly2/2/14/9059/5727" +
        "?access_token=" + ACCESS_TOKEN;


    try {

        const response = await fetch(url);


        status.textContent +=
            "\nHTTP válasz: "
            + response.status;


        if (!response.ok)
        {
            throw new Error(
                "HTTP hiba: " + response.status
            );
        }


        const data = await response.arrayBuffer();


        status.textContent +=
            "\nSikeresen letöltve.";

        status.textContent +=
            "\nMéret: "
            + data.byteLength
            + " byte";


        status.textContent +=
            "\n\nKövetkező lépés: MVT dekódolás.";

    }

    catch(error)
    {
        status.textContent +=
            "\n\nHIBA:";
        
        status.textContent +=
            "\n" + error;
    }
}


testMapillary();
