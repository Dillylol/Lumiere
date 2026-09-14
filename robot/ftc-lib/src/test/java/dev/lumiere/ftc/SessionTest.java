package dev.lumiere.ftc;

import static com.pedropathing.api.Paths.line;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.algorithm.ForesightConfig;
import com.pedropathing.controllers.Controller;
import com.pedropathing.drivetrain.DrivePowers;
import com.pedropathing.drivetrain.Drivetrain;
import com.pedropathing.follower.Follower;
import com.pedropathing.localization.Localizer;
import com.pedropathing.localization.MotionState;
import com.pedropathing.math.Matrix;
import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.math.Velocity;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import dev.lumiere.ftc.internal.Json;

import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public class SessionTest {
    private final List<String> sent = Collections.synchronizedList(new ArrayList<>());
    private final Stream.Transport transport = new Stream.Transport() {
        @Override public boolean hasClients() { return true; }
        @Override public void broadcast(String message) { sent.add(message); }
    };

    @After
    public void removeTransport() {
        Stream.uninstall(transport);
    }

    @Autonomous(name = "Blue Close", group = "Match")
    public static class NamedAuto extends OpMode {
        @Override public void init() { }
        @Override public void loop() { }
    }

    public static class UnnamedOpMode extends OpMode {
        @Override public void init() { }
        @Override public void loop() { }
    }

    @Test
    public void usesTheDriverStationName() {
        assertEquals("Blue Close", Session.displayName(new NamedAuto()));
        assertEquals("UnnamedOpMode", Session.displayName(new UnnamedOpMode()));
    }

    @Test
    public void reportsNothingWithoutClients() {
        Session session = Session.attach(new NamedAuto()).data("a", 1);
        session.update();
        assertTrue(sent.isEmpty());
    }

    @Test
    public void reportsPoseTargetPathAndDataWhileFollowing() {
        Stream.install(transport);
        Follower follower = new Follower(new FixedLocalizer(new Pose(24, 72, 0)), new NullDrivetrain(), new Foresight(config()));
        follower.follow(line(new Pose(24, 72, 0), new Pose(72, 72, 0)).constant(0));
        follower.update();

        Session session = Session.attach(new NamedAuto()).follower(follower);
        session.data("intake", "running").update();

        Map<String, Object> path = find("path");
        List<?> points = (List<?>) path.get("points");
        assertEquals(65, points.size());
        assertEquals(Json.parse("[24,72]"), points.get(0));
        assertEquals(Json.parse("[72,72]"), points.get(64));

        Map<String, Object> state = find("state");
        assertEquals("Blue Close", state.get("opMode"));
        assertEquals("follow", state.get("follower"));
        assertEquals(24.0, ((Map<?, ?>) state.get("pose")).get("x"));
        assertNotNull(state.get("target"));
        assertEquals("running", ((Map<?, ?>) state.get("data")).get("intake"));

        int before = sent.size();
        session.update();
        assertEquals("rate limited to 20 reports per second", before, sent.size());
    }

    @Test
    public void aFailingFollowerDisablesReportingInsteadOfThrowing() {
        Stream.install(transport);
        Follower broken = new Follower(new FixedLocalizer(null), new NullDrivetrain(), new Foresight(config())) {
            @Override public Pose pose() { throw new IllegalStateException("localizer unplugged"); }
        };
        Session session = Session.attach(new NamedAuto()).follower(broken);
        session.update();
        session.update();
        session.close();
        assertTrue(sent.isEmpty());
    }

    private Map<String, Object> find(String type) {
        synchronized (sent) {
            for (String message : sent) {
                Map<String, Object> parsed = Json.parseObject(message);
                if (parsed != null && type.equals(parsed.get("type"))) return parsed;
            }
        }
        throw new AssertionError("No " + type + " message in " + sent);
    }

    static ForesightConfig config() {
        return new ForesightConfig(c -> {
            c.forwardTranslational.set(Controller.proportional(0.1));
            c.strafeTranslational.set(Controller.proportional(0.1));
            c.coast.set(Controller.proportionalFeedforward(0.016));
            c.brake.set(Controller.proportionalFeedforward(0.016));
            c.headingFeedback.set(Controller.proportional(1));
            c.headingBrakeCoefficients.set(Vector2D.cartesian(0.1, 0));
            c.linearBrakeCoefficients.set(Matrix.diag(0.05, 0.06));
            c.quadraticBrakeCoefficients.set(Matrix.diag(0.0015, 0.002));
            c.maxAchievableForwardVelocity.set(60.0);
            c.maxAchievableStrafeVelocity.set(50.0);
            c.naturalForwardDeceleration.set(40.0);
            c.naturalStrafeDeceleration.set(50.0);
        });
    }

    static final class FixedLocalizer implements Localizer {
        private MotionState state;
        FixedLocalizer(Pose pose) { state = pose == null ? MotionState.zero() : MotionState.ofVelocity(pose, Velocity.zero()); }
        @Override public void setPose(Pose pose) { state = state.withPose(pose); }
        @Override public MotionState state() { return state; }
        @Override public void update() { }
        @Override public void reset() { }
    }

    static final class NullDrivetrain implements Drivetrain {
        @Override public void drive(DrivePowers powers, boolean manual) { }
        @Override public double maxScaling(DrivePowers current, DrivePowers delta) { return 1; }
        @Override public void stop() { }
        @Override public void stop(boolean brake) { }
        @Override public Map<String, Object> debug() { return Collections.emptyMap(); }
        @Override public double interpolateVelocity(double xRadius, double yRadius, double theta) { return xRadius; }
    }
}
