package dev.lumiere.devtools.virtualhub.live;

import com.pedropathing.follower.Follower;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.hardware.HardwareMap;

import dev.lumiere.ftc.live.LiveRunner;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Lumière Live as the app generates it, for the virtual hub's contract checks only. Its pairing
 * secret is random for each run and reaches the test JVM in VH_LIVE_SECRET, never on a command line.
 * Like the generated file, it builds the project's own follower from its Pedro constants class, here
 * the one the simulator's configuration names.
 */
@Autonomous(name = "Lumière Live (virtual hub)", group = "Virtual hub")
public class VirtualLive extends LiveRunner {
    /** Set by the virtual hub from its configuration. */
    public static final String CONSTANTS_PROPERTY = "vh.constantsClass";

    @Override
    protected String pairingHash() {
        String secret = System.getenv("VH_LIVE_SECRET");
        if (secret == null) return "";
        try {
            StringBuilder hex = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8))) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    protected Class<?> pedroConstants() {
        try {
            return Class.forName(System.getProperty(CONSTANTS_PROPERTY, "org.firstinspires.ftc.teamcode.pedro.Constants"));
        } catch (ClassNotFoundException e) {
            return null;
        }
    }

    @Override
    protected Follower createFollower(HardwareMap hardwareMap) {
        Class<?> constants = pedroConstants();
        if (constants == null) throw new IllegalStateException("The project's Pedro constants class was not found.");
        try {
            return (Follower) constants.getMethod("create", HardwareMap.class).invoke(null, hardwareMap);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("The project's Pedro constants have no usable create(HardwareMap): " + e, e);
        }
    }
}
