-- Camera positions fitted from their pictures (skyline match, tools/sun3d README / sun-time check, 12 Nov 2026).
-- Old: GT-JHMR-SUMMIT 43.5958, -110.8475 (1.9 km off); GT-JHMR-RENDEZVOUS 43.5935, -110.843 (1.3 km off); GT-TETONIA 43.8135, -111.158 (~8 km off).
-- Effect: no camera enters or leaves any 12 km check; TetonCam comes within 50 km of 1-2 more stops.
update webcam_cameras set lat = 43.5972, lng = -110.8707 where code = 'GT-JHMR-SUMMIT';
update webcam_cameras set lat = 43.6012, lng = -110.8545 where code = 'GT-JHMR-RENDEZVOUS';
update webcam_cameras set lat = 43.762, lng = -111.083 where code = 'GT-TETONIA';
